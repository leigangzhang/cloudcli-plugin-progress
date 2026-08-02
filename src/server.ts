import fs from 'node:fs';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';
 import { ConversationBuffer } from './core/buffer.js';
 import { loadConfig, redactApiKey } from './core/config.js';
 import { DiffDetectorImpl } from './core/diff-detector.js';
import { LLMExtractionEngineImpl } from './core/extractor.js';
import { isWatchRequest, parseJsonLine } from './core/protocol.js';
import { ProgressStoreImpl } from './core/store.js';
import { FileLogWatcher } from './core/watcher.js';
import type {
  LLMConfig,
  LLMExtractionEngine,
  LogEntry,
  ProgressResponse,
  ProgressTree,
  ServerMessage,
} from './core/types.js';

export interface ProgressServerOptions {
  port?: number;
  config?: LLMConfig;
  projectsDir?: string;
  snapshotDir?: string;
  extractor?: LLMExtractionEngine;
  detectorOptions?: import('./core/diff-detector.js').DiffDetectorOptions;
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
   private watcher: FileLogWatcher;
   private buffer: ConversationBuffer;
  private detector: DiffDetectorImpl;
  private store: ProgressStoreImpl;
  private extractor?: LLMExtractionEngine;
  private clients = new Set<WebSocket>();
   private config: LLMConfig;
   private options: ProgressServerOptions;
   private activeProjectPath: string | null = null;
   private activeSessionId: string | null = null;
   private status: ProgressResponse['status'] = 'idle';
   private errorMessage?: string;

   constructor(options: ProgressServerOptions = {}) {
     this.options = options;
     try {
       this.config = options.config ?? loadConfig();
     } catch (err) {
       this.config = { apiKey: '', model: 'unknown' };
       this.status = 'error';
       this.errorMessage = (err as Error).message;
     }
     this.buffer = new ConversationBuffer();
     this.store = new ProgressStoreImpl({ snapshotDir: options.snapshotDir });
     this.detector = new DiffDetectorImpl(this.buffer, this.options.detectorOptions);
     this.watcher = new FileLogWatcher({ projectsDir: options.projectsDir });
     this.bindDetector();
     this.store.subscribe((tree) => this.broadcast({ type: 'progress', tree }));
   }

  async start(): Promise<{ port: number }> {
    this.extractor =
      this.options.extractor ??
      (this.config.apiKey ? new LLMExtractionEngineImpl({ config: this.config }) : undefined);
     return new Promise((resolve, reject) => {
       this.httpServer = http.createServer((req, res) => void this.handleHttp(req, res));
       this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
       this.wss.on('connection', (ws) => this.handleWs(ws));
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
     this.watcher.stop();
     this.clients.forEach((ws) => ws.close());
     this.clients.clear();
     await new Promise<void>((resolve) => {
       this.wss?.close(() => resolve());
     });
     await new Promise<void>((resolve, reject) => {
       this.httpServer?.close((err) => (err ? reject(err) : resolve()));
     });
   }

   private bindDetector(): void {
     this.detector.onTrigger(async (segments) => {
       if (!this.extractor) return;
       this.setStatus('syncing');
       try {
         const updated = await this.extractor.extract(this.store.getState(), segments);
         this.store.setState(updated);
         this.setStatus('idle');
       } catch (err) {
         const message = (err as Error).message;
         console.error('Extraction failed:', redactApiKey(message, this.config.apiKey));
         this.setStatus('error', message);
       }
     });
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
         this.handleProgress(res);
         return;
       }
       if (req.method === 'POST' && url.pathname === '/refresh') {
         await this.handleRefresh(req, res);
         return;
       }
       if (req.method === 'GET' && url.pathname === '/debug') {
         this.handleDebug(res);
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
     if (!this.config.apiKey) {
       res.writeHead(503);
       res.end(JSON.stringify({ error: this.errorMessage ?? 'Missing API key' }));
       return;
     }
     const body = parseJsonLine(await readBody(req));
     if (!isWatchRequest(body)) {
       res.writeHead(400);
       res.end(JSON.stringify({ error: 'Invalid watch request' }));
       return;
     }
     await this.startSession(body.projectPath, body.sessionId);
     const response = this.buildProgressResponse();
     res.writeHead(200);
     res.end(JSON.stringify(response));
   }

   private handleProgress(res: http.ServerResponse): void {
     const response = this.buildProgressResponse();
     res.writeHead(200);
     res.end(JSON.stringify(response));
   }

   private async handleRefresh(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
     if (!this.config.apiKey) {
       res.writeHead(503);
       res.end(JSON.stringify({ error: this.errorMessage ?? 'Missing API key' }));
       return;
     }
     if (!this.extractor) {
       res.writeHead(503);
       res.end(JSON.stringify({ error: 'Extractor not initialized' }));
       return;
     }
     this.setStatus('syncing');
     try {
       const segments = this.buffer.getSegments(10);
       const updated = await this.extractor.extract(this.store.getState(), segments);
       this.store.setState(updated);
       this.setStatus('idle');
     } catch (err) {
       const message = (err as Error).message;
       console.error('Refresh failed:', redactApiKey(message, this.config.apiKey));
       this.setStatus('error', message);
     }
     const response = this.buildProgressResponse();
     res.writeHead(200);
     res.end(JSON.stringify(response));
   }

   private handleDebug(res: http.ServerResponse): void {
     const logPath = this.watcher.getFilePath();
     res.writeHead(200);
     res.end(
       JSON.stringify({
         projectPath: this.activeProjectPath,
         sessionId: this.activeSessionId,
         logPath,
         logExists: logPath ? fs.existsSync(logPath) : false,
         apiKeyConfigured: !!this.config.apiKey,
         model: this.config.model,
         bufferSize: this.buffer.getSegments(200).length,
         status: this.status,
         error: this.errorMessage,
       }),
     );
   }

   private buildProgressResponse(): ProgressResponse {
     return {
       tree: this.store.getState(),
       status: this.status,
       error: this.errorMessage,
     };
   }

   private async startSession(projectPath: string, sessionId: string): Promise<void> {
     this.activeProjectPath = projectPath;
     this.activeSessionId = sessionId;
     this.watcher.stop();
     this.buffer = new ConversationBuffer();
     this.detector = new DiffDetectorImpl(this.buffer, this.options.detectorOptions);
     this.bindDetector();
     if (!this.store.loadSnapshot(sessionId)) {
       this.store.setState({ version: 0, goals: [] });
     }
     this.watcher = new FileLogWatcher({ projectsDir: this.options.projectsDir });
     this.watcher.onLine((entry: LogEntry) => {
       this.buffer.push(entry);
       this.detector.ingest(entry);
     });
     await this.watcher.start(projectPath, sessionId);
     const logPath = this.watcher.getFilePath();
     if (logPath && !fs.existsSync(logPath)) {
       this.setStatus('error', `Session log not found: ${logPath}`);
     } else {
       this.setStatus('idle');
     }
   }

  private handleWs(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    ws.on('message', (raw) => {
      const parsed = parseJsonLine(raw.toString());
      if (parsed && typeof parsed === 'object' && (parsed as { type?: string }).type === 'subscribe') {
        this.send(ws, { type: 'progress', tree: this.store.getState() });
        this.send(ws, { type: 'status', status: this.status, error: this.errorMessage });
      }
    });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

   private broadcast(message: ServerMessage): void {
     this.clients.forEach((ws) => this.send(ws, message));
   }

   private setStatus(status: ProgressResponse['status'], error?: string): void {
     this.status = status;
     this.errorMessage = error;
     this.broadcast({ type: 'status', status, error });
   }
 }

 // If this file is executed directly, start the server and print the ready signal.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = new ProgressServer();
  void server.start();
}
