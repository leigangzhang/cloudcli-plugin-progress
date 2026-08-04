import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../src/core/config.js';
import { createTempDir } from '../utils.js';

describe('loadConfig', () => {
  it('reads API key, base URL and model from settings.json env block', () => {
    const tmp = createTempDir();
    const settingsPath = path.join(tmp.path, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_API_KEY: 'settings-token',
          ANTHROPIC_BASE_URL: 'https://settings.example',
          PROGRESS_MODEL: 'settings-model',
        },
      }),
      'utf-8',
    );

    const config = loadConfig({ settingsPath });
    expect(config.apiKey).toBe('settings-token');
    expect(config.baseUrl).toBe('https://settings.example');
    expect(config.model).toBe('settings-model');
    tmp.cleanup();
  });

  it('reads API key, base URL and model from project .env', () => {
    const tmp = createTempDir();
    const projectPath = tmp.path;
    fs.writeFileSync(
      path.join(projectPath, '.env'),
      'ANTHROPIC_API_KEY=project-token\nANTHROPIC_BASE_URL=https://project.example\nPROGRESS_MODEL=project-model',
      'utf-8',
    );

    const config = loadConfig({ projectPath });
    expect(config.apiKey).toBe('project-token');
    expect(config.baseUrl).toBe('https://project.example');
    expect(config.model).toBe('project-model');
    tmp.cleanup();
  });

  it('project .env overrides settings.json and environment variables', () => {
    const tmp = createTempDir();
    const projectPath = tmp.path;
    const settingsPath = path.join(tmp.path, 'settings.json');
    fs.writeFileSync(
      path.join(projectPath, '.env'),
      'ANTHROPIC_API_KEY=project-token\nPROGRESS_MODEL=project-model',
      'utf-8',
    );
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_API_KEY: 'settings-token',
          PROGRESS_MODEL: 'settings-model',
        },
      }),
      'utf-8',
    );

    const config = loadConfig({
      projectPath,
      settingsPath,
      env: {
        ANTHROPIC_API_KEY: 'env-token',
        PROGRESS_MODEL: 'env-model',
      },
    });
    expect(config.apiKey).toBe('project-token');
    expect(config.model).toBe('project-model');
    tmp.cleanup();
  });

  it('falls back to legacy ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL names', () => {
    const tmp = createTempDir();
    const settingsPath = path.join(tmp.path, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'legacy-token',
          ANTHROPIC_MODEL: 'legacy-model',
        },
      }),
      'utf-8',
    );

    const config = loadConfig({ settingsPath });
    expect(config.apiKey).toBe('legacy-token');
    expect(config.model).toBe('legacy-model');
    tmp.cleanup();
  });

  it('prefers ANTHROPIC_API_KEY over ANTHROPIC_AUTH_TOKEN', () => {
    const config = loadConfig({
      settingsPath: '/nonexistent/settings.json',
      env: {
        ANTHROPIC_API_KEY: 'api-key-token',
        ANTHROPIC_AUTH_TOKEN: 'auth-token',
      },
    });
    expect(config.apiKey).toBe('api-key-token');
  });

  it('prefers PROGRESS_MODEL over ANTHROPIC_MODEL', () => {
    const config = loadConfig({
      settingsPath: '/nonexistent/settings.json',
      env: {
        ANTHROPIC_API_KEY: 'token',
        PROGRESS_MODEL: 'progress-model',
        ANTHROPIC_MODEL: 'anthropic-model',
      },
    });
    expect(config.model).toBe('progress-model');
  });

  it('falls back to environment variables when settings.json is missing', () => {
    const config = loadConfig({
      settingsPath: '/nonexistent/settings.json',
      env: {
        ANTHROPIC_API_KEY: 'env-token',
        ANTHROPIC_BASE_URL: 'https://env.example',
        PROGRESS_MODEL: 'env-model',
      },
    });
    expect(config.apiKey).toBe('env-token');
    expect(config.baseUrl).toBe('https://env.example');
    expect(config.model).toBe('env-model');
  });

  it('falls back to X-Plugin-Secret headers when env vars are missing', () => {
    const config = loadConfig({
      settingsPath: '/nonexistent/settings.json',
      env: {},
      headers: {
        'x-plugin-secret-anthropic-api-key': 'header-token',
        'x-plugin-secret-anthropic-base-url': 'https://header.example',
        'x-plugin-secret-progress-model': 'header-model',
      },
    });
    expect(config.apiKey).toBe('header-token');
    expect(config.baseUrl).toBe('https://header.example');
    expect(config.model).toBe('header-model');
  });

  it('prefers settings.json over env and headers when no project .env', () => {
    const tmp = createTempDir();
    const settingsPath = path.join(tmp.path, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_API_KEY: 'settings-token',
          PROGRESS_MODEL: 'settings-model',
        },
      }),
      'utf-8',
    );

    const config = loadConfig({
      settingsPath,
      env: {
        ANTHROPIC_API_KEY: 'env-token',
        PROGRESS_MODEL: 'env-model',
      },
      headers: {
        'x-plugin-secret-anthropic-api-key': 'header-token',
        'x-plugin-secret-progress-model': 'header-model',
      },
    });
    expect(config.apiKey).toBe('settings-token');
    expect(config.model).toBe('settings-model');
    tmp.cleanup();
  });

  it('uses default model when none is provided', () => {
    const config = loadConfig({
      settingsPath: '/nonexistent/settings.json',
      env: { ANTHROPIC_API_KEY: 'token' },
    });
    expect(config.apiKey).toBe('token');
    expect(config.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('throws when no API key is found', () => {
    expect(() =>
      loadConfig({
        settingsPath: '/nonexistent/settings.json',
        env: {},
      }),
    ).toThrow(/Anthropic API key/);
  });
});
