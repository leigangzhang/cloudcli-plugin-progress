import fs from 'node:fs';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';
import { ConversationBuffer } from './core/buffer.js';
import { loadConfig, redactApiKey } from './core/config.js';
import { DiffDetectorImpl } from './core/diff-detector.js';
import { LLMExtractionEngineImpl } from './core/extractor.js';
import { isRefreshRequest, isWatchRequest, parseJsonLine } from './core/protocol.js';
import { resolveSessionLogPath } from './core/paths.js';
import { ProgressStoreImpl } from './core/store.js';
import { buildTurnsFromLog } from './core/turns.js';
import { FileLogWatcher } from './core/watcher.js';
function readBody(req) {
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
    constructor(options = {}) {
        this.clients = new Map();
        this.sessions = new Map();
        this.cloudcliToReal = new Map();
        this.options = options;
        try {
            this.config = options.config ?? loadConfig();
        }
        catch (err) {
            this.config = { apiKey: '', model: 'unknown' };
        }
    }
    async start() {
        this.extractor =
            this.options.extractor ??
                (this.config.apiKey ? new LLMExtractionEngineImpl({ config: this.config }) : undefined);
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
                }
                else {
                    reject(new Error('Failed to determine server port'));
                }
            });
        });
    }
    async stop() {
        this.sessions.forEach((session) => session.watcher.stop());
        this.sessions.clear();
        this.cloudcliToReal.clear();
        this.clients.forEach((_, ws) => ws.close());
        this.clients.clear();
        await new Promise((resolve) => {
            this.wss?.close(() => resolve());
        });
        await new Promise((resolve, reject) => {
            this.httpServer?.close((err) => (err ? reject(err) : resolve()));
        });
    }
    chooseExtractor(session) {
        return session.extractor ?? this.extractor;
    }
    createSessionExtractor(session) {
        try {
            const sessionConfig = loadConfig({ projectPath: session.projectPath });
            session.extractor = new LLMExtractionEngineImpl({ config: sessionConfig });
        }
        catch {
            // Project .env is either missing or incomplete. Fall back to the server-level
            // extractor if it exists; otherwise leave session.extractor undefined so the
            // UI gets a clear error when trying to refresh.
        }
    }
    bindDetector(session) {
        session.detector.onTrigger(async () => {
            const extractor = this.chooseExtractor(session);
            if (!extractor)
                return;
            this.setStatus(session.sessionId, 'syncing');
            try {
                const turns = session.buffer.getTurns();
                const updated = await extractor.extract(session.store.getState(), turns);
                session.store.setState(updated);
                this.setStatus(session.sessionId, 'idle');
            }
            catch (err) {
                const message = err.message;
                const apiKey = session.extractor ? this.config.apiKey : this.config.apiKey;
                console.error('Extraction failed:', redactApiKey(message, apiKey));
                this.setStatus(session.sessionId, 'error', message);
            }
        });
    }
    migrateClients(fromSessionId, toSessionId) {
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
    async getOrCreateSession(cloudcliSessionId, projectPath) {
        const resolved = await resolveSessionLogPath(projectPath, cloudcliSessionId, this.options.projectsDir);
        const realSessionId = resolved.realSessionId;
        this.cloudcliToReal.set(cloudcliSessionId, realSessionId);
        this.migrateClients(cloudcliSessionId, realSessionId);
        let session = this.sessions.get(realSessionId);
        if (session) {
            session.cloudcliSessionId = cloudcliSessionId;
            if (projectPath && session.projectPath !== projectPath) {
                session.projectPath = projectPath;
                session.extractor = undefined;
                this.createSessionExtractor(session);
                session.watcher.stop();
                session.watcher = new FileLogWatcher({ projectsDir: this.options.projectsDir });
                session.watcher.onLine((entry) => {
                    session.buffer.push(entry);
                    session.detector.ingest(entry);
                });
                await session.watcher.start(projectPath, realSessionId);
                const logPath = session.watcher.getFilePath();
                if (logPath && !fs.existsSync(logPath)) {
                    this.setStatus(realSessionId, 'error', `Session log not found: ${logPath}`);
                }
            }
            return session;
        }
        const buffer = new ConversationBuffer();
        const store = new ProgressStoreImpl({ snapshotDir: this.options.snapshotDir });
        const detector = new DiffDetectorImpl(buffer, this.options.detectorOptions);
        const watcher = new FileLogWatcher({ projectsDir: this.options.projectsDir });
        session = {
            projectPath,
            sessionId: realSessionId,
            cloudcliSessionId,
            watcher,
            buffer,
            detector,
            store,
            status: 'idle',
        };
        this.createSessionExtractor(session);
        this.bindDetector(session);
        session.store.subscribe((tree) => this.broadcast(realSessionId, { type: 'progress', tree }));
        session.store.subscribe(() => {
            try {
                session.store.saveSnapshot(realSessionId);
            }
            catch (err) {
                console.error('Failed to save snapshot:', err.message);
            }
        });
        watcher.onLine((entry) => {
            session.buffer.push(entry);
            session.detector.ingest(entry);
        });
        if (!store.loadSnapshot(realSessionId)) {
            store.setState({ version: 0, goals: [] });
        }
        await watcher.start(projectPath, realSessionId);
        const logPath = watcher.getFilePath();
        if (logPath && !fs.existsSync(logPath)) {
            this.setStatus(realSessionId, 'error', `Session log not found: ${logPath}`);
        }
        else {
            this.setStatus(realSessionId, 'idle');
        }
        this.sessions.set(realSessionId, session);
        return session;
    }
    resolveSessionId(requestedSessionId) {
        if (!requestedSessionId)
            return undefined;
        if (this.sessions.has(requestedSessionId)) {
            return requestedSessionId;
        }
        const mapped = this.cloudcliToReal.get(requestedSessionId);
        if (mapped && this.sessions.has(mapped)) {
            return mapped;
        }
        return undefined;
    }
    async handleHttp(req, res) {
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
        }
        catch (err) {
            const message = err.message;
            console.error('HTTP handler error:', redactApiKey(message, this.config.apiKey));
            res.writeHead(500);
            res.end(JSON.stringify({ error: message }));
        }
    }
    handleHealth(res) {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', model: this.config.model }));
    }
    async handleWatch(req, res) {
        const body = parseJsonLine(await readBody(req));
        if (!isWatchRequest(body)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid watch request' }));
            return;
        }
        const session = await this.getOrCreateSession(body.sessionId, body.projectPath);
        if (!this.chooseExtractor(session)) {
            this.setStatus(session.sessionId, 'error', 'Missing API key. Set ANTHROPIC_API_KEY in project .env or plugin environment.');
        }
        const response = this.buildProgressResponse(session);
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }
    handleProgress(res, url) {
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
    async handleRefresh(req, res) {
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
            const logPath = session.watcher.getFilePath();
            const turns = logPath && fs.existsSync(logPath) ? buildTurnsFromLog(logPath) : session.buffer.getTurns();
            const updated = await extractor.extract(session.store.getState(), turns);
            session.store.setState(updated);
            this.setStatus(sessionId, 'idle');
            try {
                session.store.saveSnapshot(sessionId);
            }
            catch (err) {
                console.error('Failed to save snapshot:', err.message);
            }
        }
        catch (err) {
            const message = err.message;
            console.error('Refresh failed:', redactApiKey(message, this.config.apiKey));
            this.setStatus(sessionId, 'error', message);
        }
        const response = this.buildProgressResponse(session);
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }
    handleTurn(res, url) {
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
        const logPath = session.watcher.getFilePath();
        const turns = logPath && fs.existsSync(logPath) ? buildTurnsFromLog(logPath) : session.buffer.getTurns();
        const turn = turns.find((t) => t.promptId === promptId);
        if (!turn) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Turn not found' }));
            return;
        }
        res.writeHead(200);
        res.end(JSON.stringify(turn));
    }
    handleDebug(res, url) {
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
        const turns = logPath && fs.existsSync(logPath) ? buildTurnsFromLog(logPath) : [];
        const extractor = session.extractor;
        const config = extractor ? undefined : this.config;
        res.writeHead(200);
        res.end(JSON.stringify({
            projectPath: session.projectPath,
            requestedSessionId: session.cloudcliSessionId,
            sessionId: session.sessionId,
            logPath,
            logExists: logPath ? fs.existsSync(logPath) : false,
            apiKeyConfigured: !!(extractor || this.config.apiKey),
            model: this.config.model,
            projectModel: config?.model,
            bufferSize: session.buffer.getTurns().length,
            logTurnCount: turns.length,
            status: session.status,
            error: session.errorMessage,
        }));
    }
    buildProgressResponse(session) {
        return {
            tree: session.store.getState(),
            status: session.status,
            error: session.errorMessage,
            sessionId: session.sessionId,
        };
    }
    getDefaultSessionId() {
        if (this.sessions.size === 1) {
            return Array.from(this.sessions.keys())[0];
        }
        return undefined;
    }
    handleWs(ws) {
        ws.on('close', () => this.clients.delete(ws));
        ws.on('error', () => this.clients.delete(ws));
        ws.on('message', (raw) => {
            const parsed = parseJsonLine(raw.toString());
            if (!parsed || typeof parsed !== 'object')
                return;
            const typed = parsed;
            if (typed.type === 'subscribe') {
                const msg = parsed;
                if (typeof msg.projectPath === 'string' && typeof msg.sessionId === 'string') {
                    const realSessionId = this.resolveSessionId(msg.sessionId) ?? msg.sessionId;
                    this.clients.set(ws, realSessionId);
                    const session = this.sessions.get(realSessionId);
                    if (session) {
                        this.send(ws, { type: 'progress', tree: session.store.getState() });
                        this.send(ws, { type: 'status', status: session.status, error: session.errorMessage });
                    }
                    else {
                        this.send(ws, { type: 'progress', tree: { version: 0, goals: [] } });
                        this.send(ws, { type: 'status', status: 'idle' });
                    }
                }
            }
        });
    }
    send(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    broadcast(sessionId, message) {
        this.clients.forEach((sid, ws) => {
            if (sid === sessionId)
                this.send(ws, message);
        });
    }
    setStatus(sessionId, status, error) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        session.status = status;
        session.errorMessage = error;
        this.broadcast(sessionId, { type: 'status', status, error });
    }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const server = new ProgressServer();
    void server.start();
}
//# sourceMappingURL=server.js.map