import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { ConversationBuffer } from './core/buffer.js';
import { loadConfig, redactApiKey } from './core/config.js';
import { DiffDetectorImpl } from './core/diff-detector.js';
import { LLMExtractionEngineImpl } from './core/extractor.js';
import { isWatchRequest, parseJsonLine } from './core/protocol.js';
import { ProgressStoreImpl } from './core/store.js';
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
        this.clients = new Set();
        this.activeSessionId = null;
        this.status = 'idle';
        this.options = options;
        this.config = options.config ?? loadConfig();
        this.buffer = new ConversationBuffer();
        this.store = new ProgressStoreImpl({ snapshotDir: options.snapshotDir });
        this.detector = new DiffDetectorImpl(this.buffer, this.options.detectorOptions);
        this.watcher = new FileLogWatcher({ projectsDir: options.projectsDir });
        this.bindDetector();
        this.store.subscribe((tree) => this.broadcast({ type: 'progress', tree }));
    }
    async start() {
        this.extractor = this.options.extractor ?? new LLMExtractionEngineImpl({ config: this.config });
        return new Promise((resolve, reject) => {
            this.httpServer = http.createServer((req, res) => void this.handleHttp(req, res));
            this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
            this.wss.on('connection', (ws) => this.handleWs(ws));
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
        this.watcher.stop();
        this.clients.forEach((ws) => ws.close());
        this.clients.clear();
        await new Promise((resolve) => {
            this.wss?.close(() => resolve());
        });
        await new Promise((resolve, reject) => {
            this.httpServer?.close((err) => (err ? reject(err) : resolve()));
        });
    }
    bindDetector() {
        this.detector.onTrigger(async (segments) => {
            if (!this.extractor)
                return;
            this.setStatus('syncing');
            try {
                const updated = await this.extractor.extract(this.store.getState(), segments);
                this.store.setState(updated);
                this.setStatus('idle');
            }
            catch (err) {
                const message = err.message;
                console.error('Extraction failed:', redactApiKey(message, this.config.apiKey));
                this.setStatus('error', message);
            }
        });
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
                this.handleProgress(res);
                return;
            }
            if (req.method === 'POST' && url.pathname === '/refresh') {
                await this.handleRefresh(req, res);
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
        await this.startSession(body.projectPath, body.sessionId);
        const response = this.buildProgressResponse();
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }
    handleProgress(res) {
        const response = this.buildProgressResponse();
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }
    async handleRefresh(req, res) {
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
        }
        catch (err) {
            const message = err.message;
            console.error('Refresh failed:', redactApiKey(message, this.config.apiKey));
            this.setStatus('error', message);
        }
        const response = this.buildProgressResponse();
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }
    buildProgressResponse() {
        return {
            tree: this.store.getState(),
            status: this.status,
            error: this.errorMessage,
        };
    }
    async startSession(projectPath, sessionId) {
        this.activeSessionId = sessionId;
        this.watcher.stop();
        this.buffer = new ConversationBuffer();
        this.detector = new DiffDetectorImpl(this.buffer, this.options.detectorOptions);
        this.bindDetector();
        if (!this.store.loadSnapshot(sessionId)) {
            this.store.setState({ version: 0, goals: [] });
        }
        this.watcher = new FileLogWatcher({ projectsDir: this.options.projectsDir });
        this.watcher.onLine((entry) => {
            this.buffer.push(entry);
            this.detector.ingest(entry);
        });
        await this.watcher.start(projectPath, sessionId);
        this.setStatus('idle');
    }
    handleWs(ws) {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
        ws.on('error', () => this.clients.delete(ws));
        ws.on('message', (raw) => {
            const parsed = parseJsonLine(raw.toString());
            if (parsed && typeof parsed === 'object' && parsed.type === 'subscribe') {
                this.send(ws, { type: 'progress', tree: this.store.getState() });
                this.send(ws, { type: 'status', status: this.status, error: this.errorMessage });
            }
        });
    }
    send(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    broadcast(message) {
        this.clients.forEach((ws) => this.send(ws, message));
    }
    setStatus(status, error) {
        this.status = status;
        this.errorMessage = error;
        this.broadcast({ type: 'status', status, error });
    }
}
// If this file is executed directly, start the server and print the ready signal.
if (import.meta.url === `file://${process.argv[1]}`) {
    const server = new ProgressServer();
    void server.start();
}
//# sourceMappingURL=server.js.map