import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
function getPluginRoot() {
    const cwd = process.cwd();
    // CloudCLI usually starts the plugin server with cwd set to the plugin install
    // directory. If a .env exists there, prefer it over the computed module path.
    if (fs.existsSync(path.join(cwd, '.env'))) {
        return cwd;
    }
    try {
        return path.resolve(fileURLToPath(import.meta.url), '..', '..');
    }
    catch {
        return cwd;
    }
}
function normalizeHeaders(headers) {
    const out = {};
    if (!headers)
        return out;
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            out[key.toLowerCase()] = value;
        }
    }
    return out;
}
function readSettingsEnv(settingsPath) {
    try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const env = parsed.env ?? {};
        return {
            apiKey: env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN,
            baseUrl: env.ANTHROPIC_BASE_URL,
            model: env.PROGRESS_MODEL ?? env.ANTHROPIC_MODEL,
        };
    }
    catch {
        return {};
    }
}
function readEnvFile(basePath) {
    const envPath = path.join(basePath, '.env');
    if (!fs.existsSync(envPath))
        return {};
    try {
        const raw = fs.readFileSync(envPath, 'utf-8');
        const vars = {};
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const eq = trimmed.indexOf('=');
            if (eq === -1)
                continue;
            const key = trimmed.slice(0, eq).trim();
            let value = trimmed.slice(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            vars[key] = value;
        }
        return {
            apiKey: vars.ANTHROPIC_API_KEY ?? vars.ANTHROPIC_AUTH_TOKEN ?? vars.API_KEY,
            baseUrl: vars.ANTHROPIC_BASE_URL ?? vars.BASE_URL,
            model: vars.PROGRESS_MODEL ?? vars.ANTHROPIC_MODEL ?? vars.MODEL,
        };
    }
    catch {
        return {};
    }
}
export function loadConfig(options) {
    const projectEnv = options?.projectPath ? readEnvFile(options.projectPath) : {};
    const pluginRoot = options?.pluginRoot ?? getPluginRoot();
    const pluginEnv = readEnvFile(pluginRoot);
    const settingsPath = options?.settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
    const env = options?.env ?? process.env;
    const headers = normalizeHeaders(options?.headers);
    const settings = readSettingsEnv(settingsPath);
    const apiKey = projectEnv.apiKey ??
        pluginEnv.apiKey ??
        settings.apiKey ??
        env.ANTHROPIC_API_KEY ??
        env.ANTHROPIC_AUTH_TOKEN ??
        headers['x-plugin-secret-anthropic-api-key'] ??
        headers['x-plugin-secret-anthropic-auth-token'];
    if (!apiKey) {
        throw new Error('Missing Anthropic API key. Set ANTHROPIC_API_KEY in project .env, plugin .env, ~/.claude/settings.json, environment variables, or X-Plugin-Secret headers.');
    }
    return {
        apiKey,
        baseUrl: projectEnv.baseUrl ??
            pluginEnv.baseUrl ??
            settings.baseUrl ??
            env.ANTHROPIC_BASE_URL ??
            headers['x-plugin-secret-anthropic-base-url'],
        model: projectEnv.model ??
            pluginEnv.model ??
            settings.model ??
            env.PROGRESS_MODEL ??
            env.ANTHROPIC_MODEL ??
            headers['x-plugin-secret-progress-model'] ??
            headers['x-plugin-secret-anthropic-model'] ??
            DEFAULT_MODEL,
        maxRetries: 3,
        requestTimeoutMs: 60000,
    };
}
export function redactApiKey(value, apiKey) {
    return value.split(apiKey).join('***');
}
//# sourceMappingURL=config.js.map