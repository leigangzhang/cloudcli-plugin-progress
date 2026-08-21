import fs from 'node:fs';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';
import { ConversationBuffer } from './core/buffer.js';
import { buildCodexTurnsFromLog } from './core/codex/parser.js';
import { loadConfig, redactApiKey } from './core/config.js';
import { DiffDetectorImpl } from './core/diff-detector.js';
import { LLMExtractionEngineImpl } from './core/extractor.js';
import { isRefreshRequest, isWatchRequest, parseJsonLine } from './core/protocol.js';
import { resolveSessionLogPath } from './core/paths.js';
import { ProgressStoreImpl } from './core/store.js';
import { buildTurnsFromLog } from './core/turns.js';
import { FileLogWatcher } from './core/watcher.js';
import {
  createTraceRequestId,
  resolveExtractionTraceEnabled,
  type ExtractionTraceContext,
  type ExtractionTraceEvent,
  writeExtractionTrace,
} from './core/trace.js';
import type {
  ConversationTurn,
  LLMConfig,
  LLMExtractionEngine,
  LogEntry,
  LogProvider,
  ProgressResponse,
  ProgressTree,
  ServerMessage,
  SessionLogEntry,
} from './core/types.js';

export interface ProgressServerOptions {
  port?: number;
  config?: LLMConfig;
  projectsDir?: string;
  snapshotDir?: string;
  extractor?: LLMExtractionEngine;
  detectorOptions?: import('./core/diff-detector.js').DiffDetectorOptions;
  traceExtractions?: boolean;
}

interface SessionState {
  projectPath: string;
  sessionId: string;
  cloudcliSessionId: string;
  provider: LogProvider;
  watcher: FileLogWatcher;
  buffer: ConversationBuffer;
  detector: DiffDetectorImpl;
  store: ProgressStoreImpl;
  extractor?: LLMExtractionEngine;
  status: ProgressResponse['status'];
  errorMessage?: string;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export class ProgressServer {
  private httpServer?: http.Server;
  private wss?: WebSocketServer;
  private extractor?: LLMExtractionEngine;
  private clients = new Map<WebSocket, string>();
  private sessions = new Map<string, SessionState>();
  private cloudcliToReal = new Map<string, string>();
  private config: LLMConfig;
  private options: ProgressServerOptions;

  constructor(options: ProgressServerOptions = {}) {
    this.options = options;
    try {
      this.config = options.config ?? loadConfig();
    } catch (err) {
      this.config = { apiKey: '', model: 'unknown' };
    }
  }

  async start(): Promise<{ port: number }> {
    this.extractor =
      this.options.extractor ??
      (this.config.apiKey
        ? new LLMExtractionEngineImpl({
            config: this.config,
            trace: (event) => this.traceExtraction(event),
          })
        : undefined);
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => void this.handleHttp(req, res));
      this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
      this.wss.on('connection', (ws) => this.handleWs(ws));
      this.httpServer.on('error', reject);
      this.httpServer.listen(this.options.port ?? 0, '127.0.0.1', () => {
        const addr = this.httpServer?.address();
        if (addr && typeof addr !== 'string') {
          console.log(JSON.stringify({ ready: true, port: addr.port }));
          resolve({ port: addr.port });
        } else {
          reject(new Error('Failed to determine server port'));
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.sessions.forEach((session) => session.watcher.stop());
    this.sessions.clear();
    this.cloudcliToReal.clear();
    this.clients.forEach((_, ws) => ws.close());
    this.clients.clear();
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer?.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private chooseExtractor(session: SessionState): LLMExtractionEngine | undefined {
    return session.extractor ?? this.extractor;
  }

  private createSessionExtractor(session: SessionState): void {
    try {
      const sessionConfig = loadConfig({ projectPath: session.projectPath });
      session.extractor = new LLMExtractionEngineImpl({
        config: sessionConfig,
        trace: (event) => this.traceExtraction(event),
      });
    } catch {
      // Project .env is either missing or incomplete. Fall back to the server-level
      // extractor if it exists; otherwise leave session.extractor undefined so the
      // UI gets a clear error when trying to refresh.
    }
  }

  private bindDetector(session: SessionState): void {
    session.detector.onTrigger(async () => {
      const extractor = this.chooseExtractor(session);
      if (!extractor) return;
      this.setStatus(session.sessionId, 'syncing');
      try {
        const turns = this.getSessionTurns(session);
        const updated = await extractor.extract(
          session.store.getState(),
          turns,
          undefined,
          this.buildTraceContext(session, 'incremental'),
        );
        session.store.setState(updated);
        this.setStatus(session.sessionId, 'idle');
      } catch (err) {
        const message = (err as Error).message;
        const apiKey = session.extractor ? this.config.apiKey : this.config.apiKey;
        console.error('Extraction failed:', redactApiKey(message, apiKey));
        this.setStatus(session.sessionId, 'error', message);
      }
    });
  }

  private migrateClients(fromSessionId: string, toSessionId: string): void {
    this.clients.forEach((sid, ws) => {
      if (sid === fromSessionId) {
        this.clients.set(ws, toSessionId);
        const session = this.sessions.get(toSessionId);
        if (session) {
          this.send(ws, { type: 'progress', tree: session.store.getState() });
          this.send(ws, { type: 'status', status: session.status, error: session.errorMessage });
        }
      }
    });
  }

  private getSessionTurns(session: SessionState): ConversationTurn[] {
    const logPath = session.watcher.getFilePath();
    if (session.provider === 'codex') {
      return logPath && fs.existsSync(logPath)
        ? buildCodexTurnsFromLog(logPath)
        : [];
    }
    return logPath && fs.existsSync(logPath)
      ? buildTurnsFromLog(logPath)
      : session.buffer.getTurns();
  }

  private buildTraceContext(
    session: SessionState,
    mode: ExtractionTraceContext['mode'],
  ): ExtractionTraceContext {
    return {
      requestId: createTraceRequestId(),
      sessionId: session.sessionId,
      cloudcliSessionId: session.cloudcliSessionId,
      projectPath: session.projectPath,
      provider: session.provider,
      logPath: session.watcher.getFilePath(),
      mode,
      parseScope: session.provider === 'codex' ? 'full_file' : 'buffer',
    };
  }

  private traceExtraction(event: ExtractionTraceEvent): void {
    if (event.context.provider !== 'codex') return;
    if (this.options.traceExtractions === false) return;
    const configuredTrace =
      this.options.traceExtractions === true ? true : this.config.traceExtractions;
    if (!resolveExtractionTraceEnabled(configuredTrace)) return;

    const traceEnv = { ...process.env };
    if (this.config.traceLogDir) {
      traceEnv.PROGRESS_TRACE_LOG_DIR = this.config.traceLogDir;
    }
    if (this.config.traceLogFile) {
      traceEnv.PROGRESS_TRACE_LOG_FILE = this.config.traceLogFile;
    }
    writeExtractionTrace({
      source: 'progress-plugin',
      timestamp: new Date().toISOString(),
      ...event,
    }, traceEnv);
  }

  private async getOrCreateSession(
    cloudcliSessionId: string,
    projectPath: string,
  ): Promise<SessionState> {
    const resolved = await resolveSessionLogPath(
      projectPath,
      cloudcliSessionId,
      this.options.projectsDir,
    );
    const realSessionId = resolved.realSessionId;
    this.cloudcliToReal.set(cloudcliSessionId, realSessionId);
    this.migrateClients(cloudcliSessionId, realSessionId);

    let session = this.sessions.get(realSessionId);
    if (session) {
      session.cloudcliSessionId = cloudcliSessionId;
      if (projectPath && session.projectPath !== projectPath) {
        session.projectPath = projectPath;
        session.provider = resolved.provider;
        session.extractor = undefined;
        this.createSessionExtractor(session);
        session.buffer = new ConversationBuffer();
        session.detector = new DiffDetectorImpl(session.buffer, {
          ...this.options.detectorOptions,
          provider: resolved.provider,
        });
        this.bindDetector(session);
        session.watcher.stop();
        session.watcher = new FileLogWatcher({ projectsDir: this.options.projectsDir });
        session.watcher.onLine((entry: SessionLogEntry) => {
          if (session!.provider === 'claude') {
            session!.buffer.push(entry as LogEntry);
          }
          session!.detector.ingest(entry);
        });
        await session.watcher.startWithPath(resolved.logPath);
        const logPath = session.watcher.getFilePath();
        if (!logPath || !fs.existsSync(logPath)) {
          this.setStatus(
            realSessionId,
            'error',
            `Session log not found: ${logPath || realSessionId}`,
          );
        }
      }
      return session;
    }

    const buffer = new ConversationBuffer();
    const store = new ProgressStoreImpl({ snapshotDir: this.options.snapshotDir });
    const detector = new DiffDetectorImpl(buffer, {
      ...this.options.detectorOptions,
      provider: resolved.provider,
    });
    const watcher = new FileLogWatcher({ projectsDir: this.options.projectsDir });

    session = {
      projectPath,
      sessionId: realSessionId,
      cloudcliSessionId,
      provider: resolved.provider,
      watcher,
      buffer,
      detector,
      store,
      status: 'idle',
    };

    this.createSessionExtractor(session);
    this.bindDetector(session);
    session.store.subscribe((tree) =>
      this.broadcast(realSessionId, { type: 'progress', tree }),
    );
    session.store.subscribe(() => {
      try {
        session!.store.saveSnapshot(realSessionId);
      } catch (err) {
        console.error('Failed to save snapshot:', (err as Error).message);
      }
    });

    watcher.onLine((entry: SessionLogEntry) => {
      if (session!.provider === 'claude') {
        session!.buffer.push(entry as LogEntry);
      }
      session!.detector.ingest(entry);
    });

    if (!store.loadSnapshot(realSessionId)) {
      store.setState({ version: 0, goals: [] });
    }

    await watcher.startWithPath(resolved.logPath);
    const logPath = watcher.getFilePath();
    if (!logPath || !fs.existsSync(logPath)) {
      this.setStatus(
        realSessionId,
        'error',
        `Session log not found: ${logPath || realSessionId}`,
      );
    } else {
      this.setStatus(realSessionId, 'idle');
    }

    this.sessions.set(realSessionId, session);
    return session;
  }

  private resolveSessionId(requestedSessionId: string | null): string | undefined {
    if (!requestedSessionId) return undefined;
    if (this.sessions.has(requestedSessionId)) {
      return requestedSessionId;
    }
    const mapped = this.cloudcliToReal.get(requestedSessionId);
    if (mapped && this.sessions.has(mapped)) {
      return mapped;
    }
    return undefined;
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        this.handleHealth(res);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/watch') {
        await this.handleWatch(req, res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/progress') {
        this.handleProgress(res, url);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/refresh') {
        await this.handleRefresh(req, res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/turn') {
        this.handleTurn(res, url);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/debug') {
        this.handleDebug(res, url);
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      const message = (err as Error).message;
      console.error('HTTP handler error:', redactApiKey(message, this.config.apiKey));
      res.writeHead(500);
      res.end(JSON.stringify({ error: message }));
    }
  }

  private handleHealth(res: http.ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', model: this.config.model }));
  }

  private async handleWatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = parseJsonLine(await readBody(req));
    if (!isWatchRequest(body)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid watch request' }));
      return;
    }
    const session = await this.getOrCreateSession(body.sessionId, body.projectPath);
    if (!this.chooseExtractor(session)) {
      this.setStatus(
        session.sessionId,
        'error',
        'Missing API key. Set ANTHROPIC_API_KEY in project .env or plugin environment.',
      );
    }
    const response = this.buildProgressResponse(session);
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  private handleProgress(res: http.ServerResponse, url: URL): void {
    const requestedSessionId = url.searchParams.get('sessionId');
    const sessionId = this.resolveSessionId(requestedSessionId ?? null) ?? this.getDefaultSessionId();
    if (!sessionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing sessionId' }));
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    const response = this.buildProgressResponse(session);
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  private async handleRefresh(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = parseJsonLine(await readBody(req));
    const requestedSessionId = isRefreshRequest(body)
      ? body.sessionId
      : this.getDefaultSessionId();
    const sessionId = this.resolveSessionId(requestedSessionId ?? null) ?? requestedSessionId;
    if (!sessionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing sessionId' }));
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    const extractor = this.chooseExtractor(session);
    if (!extractor) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Missing API key. Set ANTHROPIC_API_KEY in project .env or plugin environment.' }));
      return;
    }
    this.setStatus(sessionId, 'syncing');
    try {
      const turns = this.getSessionTurns(session);
      const updated = await extractor.extract(
        session.store.getState(),
        turns,
        (progressTree) => {
          session!.store.setState(progressTree);
        },
        this.buildTraceContext(session, 'full'),
      );
      session.store.setState(updated);
      this.setStatus(sessionId, 'idle');
      try {
        session.store.saveSnapshot(sessionId);
      } catch (err) {
        console.error('Failed to save snapshot:', (err as Error).message);
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error('Refresh failed:', redactApiKey(message, this.config.apiKey));
      this.setStatus(sessionId, 'error', message);
    }
    const response = this.buildProgressResponse(session);
    res.writeHead(200);
    res.end(JSON.stringify(response));
  }

  private handleTurn(res: http.ServerResponse, url: URL): void {
    const requestedSessionId = url.searchParams.get('sessionId');
    const promptId = url.searchParams.get('promptId');
    const sessionId = this.resolveSessionId(requestedSessionId ?? null) ?? this.getDefaultSessionId();
    if (!sessionId || !promptId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing sessionId or promptId' }));
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    const turns = this.getSessionTurns(session);
    const turn = turns.find((t) => t.promptId === promptId);
    if (!turn) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Turn not found' }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify(turn));
  }

  private handleDebug(res: http.ServerResponse, url: URL): void {
    const requestedSessionId = url.searchParams.get('sessionId');
    const sessionId = this.resolveSessionId(requestedSessionId ?? null) ?? this.getDefaultSessionId();
    if (!sessionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing sessionId' }));
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }
    const logPath = session.watcher.getFilePath();
    const turns = this.getSessionTurns(session);
    const extractor = session.extractor;
    const config = extractor ? undefined : this.config;
    res.writeHead(200);
    res.end(
      JSON.stringify({
        projectPath: session.projectPath,
        requestedSessionId: session.cloudcliSessionId,
        sessionId: session.sessionId,
        provider: session.provider,
        logPath,
        logExists: logPath ? fs.existsSync(logPath) : false,
        apiKeyConfigured: !!(extractor || this.config.apiKey),
        model: this.config.model,
        projectModel: config?.model,
        bufferSize: session.buffer.getTurns().length,
        logTurnCount: turns.length,
        status: session.status,
        error: session.errorMessage,
      }),
    );
  }

  private buildProgressResponse(session: SessionState): ProgressResponse {
    return {
      tree: session.store.getState(),
      status: session.status,
      error: session.errorMessage,
      sessionId: session.sessionId,
    };
  }

  private getDefaultSessionId(): string | undefined {
    if (this.sessions.size === 1) {
      return Array.from(this.sessions.keys())[0];
    }
    return undefined;
  }

  private handleWs(ws: WebSocket): void {
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    ws.on('message', (raw) => {
      const parsed = parseJsonLine(raw.toString());
      if (!parsed || typeof parsed !== 'object') return;
      const typed = parsed as { type?: string };
      if (typed.type === 'subscribe') {
        const msg = parsed as { projectPath?: string; sessionId?: string };
        if (typeof msg.projectPath === 'string' && typeof msg.sessionId === 'string') {
          const realSessionId = this.resolveSessionId(msg.sessionId) ?? msg.sessionId;
          this.clients.set(ws, realSessionId);
          const session = this.sessions.get(realSessionId);
          if (session) {
            this.send(ws, { type: 'progress', tree: session.store.getState() });
            this.send(ws, { type: 'status', status: session.status, error: session.errorMessage });
          } else {
            this.send(ws, { type: 'progress', tree: { version: 0, goals: [] } });
            this.send(ws, { type: 'status', status: 'idle' });
          }
        }
      }
    });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(sessionId: string, message: ServerMessage): void {
    this.clients.forEach((sid, ws) => {
      if (sid === sessionId) this.send(ws, message);
    });
  }

  private setStatus(
    sessionId: string,
    status: ProgressResponse['status'],
    error?: string,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = status;
    session.errorMessage = error;
    this.broadcast(sessionId, { type: 'status', status, error });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = new ProgressServer();
  void server.start();
}
