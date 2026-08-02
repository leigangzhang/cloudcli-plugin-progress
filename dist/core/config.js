import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
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
            apiKey: env.ANTHROPIC_AUTH_TOKEN,
            baseUrl: env.ANTHROPIC_BASE_URL,
            model: env.ANTHROPIC_MODEL,
        };
    }
    catch {
        return {};
    }
}
export function loadConfig(options) {
    const settingsPath = options?.settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
    const env = options?.env ?? process.env;
    const headers = normalizeHeaders(options?.headers);
    const settings = readSettingsEnv(settingsPath);
    const apiKey = settings.apiKey ??
        env.ANTHROPIC_AUTH_TOKEN ??
        headers['x-plugin-secret-anthropic-auth-token'];
    if (!apiKey) {
        throw new Error('Missing ANTHROPIC_AUTH_TOKEN. Set it in ~/.claude/settings.json, environment variables, or X-Plugin-Secret headers.');
    }
    return {
        apiKey,
        baseUrl: settings.baseUrl ??
            env.ANTHROPIC_BASE_URL ??
            headers['x-plugin-secret-anthropic-base-url'],
        model: settings.model ??
            env.ANTHROPIC_MODEL ??
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