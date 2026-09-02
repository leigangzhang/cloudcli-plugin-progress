import fs from 'node:fs';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';
import { ConversationBuffer } from './core/buffer.js';
import { buildCodexTurnsFromLog } from './core/codex/parser.js';
import { loadConfig, redactApiKey } from './core/config.js';
import { DiffDetectorImpl } from './core/diff-detector.js';
import { LLMExtractionEngineImpl } from './core/extractor.js';
import { isModeRequest, isRefreshRequest, isWatchRequest, parseJsonLine, } from './core/protocol.js';
import { resolveSessionLogPath } from './core/paths.js';
import { RuleBasedExtractionEngine } from './core/rule-extractor.js';
import { ProgressStoreImpl } from './core/store.js';
import { buildTurnsFromLog } from './core/turns.js';
import { FileLogWatcher } from './core/watcher.js';
import { createTraceRequestId, resolveExtractionTraceEnabled, writeExtractionTrace, } from './core/trace.js';
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
const MAX_INCREMENTAL_TURNS = 20;
export class ProgressServer {
    constructor(options = {}) {
        this.clients = new Map();
        this.sessions = new Map();
        this.extractionQueues = new Map();
        this.cloudcliToReal = new Map();
        this.ruleExtractor = new RuleBasedExtractionEngine();
        this.options = options;
        try {
            this.config = options.config ?? loadConfig();
        }
        catch (err) {
            this.config = { apiKey: '', model: 'unknown', extractionMode: 'default' };
        }
    }
    async start() {
        this.extractor =
            this.options.extractor ??
                (this.config.apiKey
                    ? new LLMExtractionEngineImpl({
                        config: this.config,
                        trace: (event) => this.traceExtraction(event),
                        similaritySplitting: true,
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
        if (session.extractionMode === 'default')
            return this.ruleExtractor;
        if (this.options.extractor)
            return this.options.extractor;
        return session.extractor ?? this.extractor;
    }
    createSessionExtractor(session) {
        session.extractor = undefined;
        if (session.extractionMode === 'default')
            return;
        if (this.options.config) {
            if (this.options.config.apiKey) {
                session.extractor = new LLMExtractionEngineImpl({
                    config: this.options.config,
                    trace: (event) => this.traceExtraction(event),
                    similaritySplitting: true,
                });
            }
            return;
        }
        try {
            const sessionConfig = loadConfig({ projectPath: session.projectPath });
            session.extractor = new LLMExtractionEngineImpl({
                config: sessionConfig,
                trace: (event) => this.traceExtraction(event),
                similaritySplitting: true,
            });
        }
        catch {
            // Project .env is either missing or incomplete. Fall back to the server-level
            // extractor if it exists; otherwise leave session.extractor undefined so the
            // UI gets a clear error when trying to refresh.
        }
    }
    bindDetector(session) {
        session.detector.onTrigger(async () => {
            await this.runExtraction(session, session.extractionMode === 'default');
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
    getSessionTurns(session) {
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
    getPendingTurns(session, turns) {
        const processedPromptIds = new Set();
        for (const goal of session.store.getState().goals) {
            for (const step of goal.steps ?? []) {
                processedPromptIds.add(step.promptId);
            }
        }
        return turns
            .filter((turn) => !processedPromptIds.has(turn.promptId))
            .slice(-MAX_INCREMENTAL_TURNS);
    }
    runExtraction(session, fullRebuild) {
        const previous = this.extractionQueues.get(session.sessionId) ?? Promise.resolve();
        const task = previous
            .catch(() => { })
            .then(() => this.performExtraction(session, fullRebuild))
            .finally(() => {
            if (this.extractionQueues.get(session.sessionId) === task) {
                this.extractionQueues.delete(session.sessionId);
            }
        });
        this.extractionQueues.set(session.sessionId, task);
        return task;
    }
    async performExtraction(session, fullRebuild) {
        const extractor = this.chooseExtractor(session);
        if (!extractor)
            return;
        const allTurns = this.getSessionTurns(session);
        const turns = fullRebuild
            ? allTurns
            : this.getPendingTurns(session, allTurns);
        if (turns.length === 0)
            return;
        this.setStatus(session.sessionId, 'syncing');
        const inputTree = fullRebuild && session.extractionMode === 'progress-tree'
            ? { version: 0, goals: [] }
            : session.store.getState();
        try {
            const updated = await extractor.extract(inputTree, turns, (progressTree) => {
                session.store.setState(progressTree);
            }, this.buildTraceContext(session, fullRebuild ? 'full' : 'incremental'));
            session.store.setState(updated);
            this.setStatus(session.sessionId, 'idle');
            if (session.extractionMode === 'progress-tree') {
                session.store.saveSnapshot(session.sessionId);
            }
        }
        catch (err) {
            const message = err.message;
            const apiKey = session.extractor ? this.config.apiKey : this.config.apiKey;
            const redacted = redactApiKey(message, apiKey);
            console.error('Extraction failed:', redacted);
            writeExtractionTrace({
                source: 'progress-plugin',
                level: 'error',
                timestamp: new Date().toISOString(),
                sessionId: session.sessionId,
                cloudcliSessionId: session.cloudcliSessionId,
                projectPath: session.projectPath,
                provider: session.provider,
                extractionMode: session.extractionMode,
                mode: fullRebuild ? 'full' : 'incremental',
                logPath: session.watcher.getFilePath(),
                error: redacted,
            }, this.buildTraceEnvironment());
            this.setStatus(session.sessionId, 'error', message);
        }
    }
    async initializeSessionTree(session) {
        await this.runExtraction(session, session.extractionMode === 'default');
    }
    buildTraceContext(session, mode) {
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
    traceExtraction(event) {
        const isErrorEvent = (event.type === 'response' && Boolean(event.error)) ||
            (event.type === 'usage' && Boolean(event.error));
        if (event.context.provider !== 'codex' && !isErrorEvent)
            return;
        if (this.options.traceExtractions === false && !isErrorEvent)
            return;
        const configuredTrace = this.options.traceExtractions === true ? true : this.config.traceExtractions;
        if (!resolveExtractionTraceEnabled(configuredTrace) && !isErrorEvent)
            return;
        writeExtractionTrace({
            source: 'progress-plugin',
            timestamp: new Date().toISOString(),
            ...event,
        }, this.buildTraceEnvironment());
    }
    buildTraceEnvironment() {
        const traceEnv = { ...process.env };
        if (this.config.traceLogDir) {
            traceEnv.PROGRESS_TRACE_LOG_DIR = this.config.traceLogDir;
        }
        if (this.config.traceLogFile) {
            traceEnv.PROGRESS_TRACE_LOG_FILE = this.config.traceLogFile;
        }
        return traceEnv;
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
                session.watcher.onLine((entry) => {
                    if (session.provider === 'claude') {
                        session.buffer.push(entry);
                    }
                    session.detector.ingest(entry);
                });
                await session.watcher.startWithPath(resolved.logPath);
                const logPath = session.watcher.getFilePath();
                if (!logPath || !fs.existsSync(logPath)) {
                    this.setStatus(realSessionId, 'error', `Session log not found: ${logPath || realSessionId}`);
                }
                else {
                    await this.runExtraction(session, true);
                }
            }
            return session;
        }
        const buffer = new ConversationBuffer();
        const store = new ProgressStoreImpl({
            snapshotDir: this.options.snapshotDir,
            extractionMode: this.config.extractionMode ?? 'default',
        });
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
            extractionMode: store.getExtractionMode(),
            status: 'idle',
        };
        if (!store.loadSnapshot(realSessionId)) {
            store.setState({ version: 0, goals: [] });
        }
        session.extractionMode = store.getExtractionMode();
        if (session.extractionMode === 'default') {
            store.setState({ version: 0, goals: [] });
        }
        this.createSessionExtractor(session);
        this.bindDetector(session);
        session.store.subscribe((tree) => this.broadcast(realSessionId, { type: 'progress', tree }));
        session.store.subscribe(() => {
            if (session.extractionMode !== 'progress-tree')
                return;
            try {
                session.store.saveSnapshot(realSessionId);
            }
            catch (err) {
                console.error('Failed to save snapshot:', err.message);
            }
        });
        watcher.onLine((entry) => {
            if (session.provider === 'claude') {
                session.buffer.push(entry);
            }
            session.detector.ingest(entry);
        });
        this.sessions.set(realSessionId, session);
        await watcher.startWithPath(resolved.logPath);
        const logPath = watcher.getFilePath();
        if (!logPath || !fs.existsSync(logPath)) {
            session.status = 'error';
            session.errorMessage = `Session log not found: ${logPath || realSessionId}`;
        }
        else {
            session.status = 'idle';
            session.errorMessage = undefined;
        }
        await this.initializeSessionTree(session);
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
            if (req.method === 'POST' && url.pathname === '/mode') {
                await this.handleMode(req, res);
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
        if (session.extractionMode === 'progress-tree' &&
            !this.chooseExtractor(session)) {
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
    async handleMode(req, res) {
        const body = parseJsonLine(await readBody(req));
        if (!isModeRequest(body)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid mode request' }));
            return;
        }
        const sessionId = this.resolveSessionId(body.sessionId) ?? body.sessionId;
        const session = this.sessions.get(sessionId);
        if (!session) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
        }
        if (session.extractionMode === body.mode) {
            const response = this.buildProgressResponse(session);
            res.writeHead(200);
            res.end(JSON.stringify(response));
            return;
        }
        if (session.extractionMode === 'progress-tree') {
            try {
                session.store.saveSnapshot(sessionId);
            }
            catch (err) {
                console.error('Failed to save snapshot:', err.message);
            }
        }
        if (body.mode === 'progress-tree') {
            const hasProgressSnapshot = session.store.loadSnapshot(sessionId) &&
                session.store.getExtractionMode() === 'progress-tree';
            if (!hasProgressSnapshot) {
                session.store.setExtractionMode('progress-tree');
                session.store.setState({ version: 0, goals: [] });
            }
        }
        session.extractionMode = body.mode;
        session.store.setExtractionMode(body.mode);
        this.createSessionExtractor(session);
        if (body.mode === 'progress-tree' &&
            !this.chooseExtractor(session)) {
            this.setStatus(sessionId, 'error', 'Missing API key. Set ANTHROPIC_API_KEY in project .env or plugin environment.');
        }
        else if (body.mode === 'progress-tree') {
            await this.runExtraction(session, false);
        }
        else {
            await this.runExtraction(session, true);
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
        await this.runExtraction(session, true);
        if (session.status !== 'error') {
            this.setStatus(sessionId, 'idle');
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
        const turns = this.getSessionTurns(session);
        const extractor = session.extractor;
        const config = extractor ? undefined : this.config;
        res.writeHead(200);
        res.end(JSON.stringify({
            projectPath: session.projectPath,
            requestedSessionId: session.cloudcliSessionId,
            sessionId: session.sessionId,
            provider: session.provider,
            extractionMode: session.extractionMode,
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
            extractionMode: session.extractionMode,
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