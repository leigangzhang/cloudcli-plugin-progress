import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LLMConfig } from './types.js';

export interface ConfigOptions {
  settingsPath?: string;
  env?: NodeJS.ProcessEnv;
  headers?: Record<string, string | string[] | undefined>;
}

const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

function normalizeHeaders(
  headers?: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

function readSettingsEnv(settingsPath: string): Partial<LLMConfig> {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw) as { env?: Record<string, string> };
    const env = parsed.env ?? {};
    return {
      apiKey: env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN,
      baseUrl: env.ANTHROPIC_BASE_URL,
      model: env.PROGRESS_MODEL ?? env.ANTHROPIC_MODEL,
    };
  } catch {
    return {};
  }
}

export function loadConfig(options?: ConfigOptions): LLMConfig {
  const settingsPath = options?.settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
  const env = options?.env ?? process.env;
  const headers = normalizeHeaders(options?.headers);

  const settings = readSettingsEnv(settingsPath);

  const apiKey =
    settings.apiKey ??
    env.ANTHROPIC_API_KEY ??
    env.ANTHROPIC_AUTH_TOKEN ??
    headers['x-plugin-secret-anthropic-api-key'] ??
    headers['x-plugin-secret-anthropic-auth-token'];

  if (!apiKey) {
    throw new Error(
      'Missing Anthropic API key. Set ANTHROPIC_API_KEY in ~/.claude/settings.json, environment variables, or X-Plugin-Secret headers.',
    );
  }

  return {
    apiKey,
    baseUrl:
      settings.baseUrl ??
      env.ANTHROPIC_BASE_URL ??
      headers['x-plugin-secret-anthropic-base-url'],
    model:
      settings.model ??
      env.PROGRESS_MODEL ??
      env.ANTHROPIC_MODEL ??
      headers['x-plugin-secret-progress-model'] ??
      headers['x-plugin-secret-anthropic-model'] ??
      DEFAULT_MODEL,
    maxRetries: 3,
    requestTimeoutMs: 60_000,
  };
}

export function redactApiKey(value: string, apiKey: string): string {
  return value.split(apiKey).join('***');
}
