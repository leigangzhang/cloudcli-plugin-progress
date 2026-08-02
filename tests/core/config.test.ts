 import { describe, expect, it } from 'vitest';
 import { loadConfig } from '../../src/core/config.js';
 import { createTempDir } from '../utils.js';
 import fs from 'node:fs';
 import path from 'node:path';

 describe('loadConfig', () => {
   it('reads API key, base URL and model from settings.json env block', () => {
     const tmp = createTempDir();
     const settingsPath = path.join(tmp.path, 'settings.json');
     fs.writeFileSync(
       settingsPath,
       JSON.stringify({
         env: {
           ANTHROPIC_AUTH_TOKEN: 'settings-token',
           ANTHROPIC_BASE_URL: 'https://settings.example',
           ANTHROPIC_MODEL: 'settings-model',
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

   it('falls back to environment variables when settings.json is missing', () => {
     const config = loadConfig({
       settingsPath: '/nonexistent/settings.json',
       env: {
         ANTHROPIC_AUTH_TOKEN: 'env-token',
         ANTHROPIC_BASE_URL: 'https://env.example',
         ANTHROPIC_MODEL: 'env-model',
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
         'x-plugin-secret-anthropic-auth-token': 'header-token',
         'x-plugin-secret-anthropic-base-url': 'https://header.example',
         'x-plugin-secret-anthropic-model': 'header-model',
       },
     });
     expect(config.apiKey).toBe('header-token');
     expect(config.baseUrl).toBe('https://header.example');
     expect(config.model).toBe('header-model');
   });

   it('prefers settings.json over env and headers', () => {
     const tmp = createTempDir();
     const settingsPath = path.join(tmp.path, 'settings.json');
     fs.writeFileSync(
       settingsPath,
       JSON.stringify({
         env: {
           ANTHROPIC_AUTH_TOKEN: 'settings-token',
           ANTHROPIC_MODEL: 'settings-model',
         },
       }),
       'utf-8',
     );

     const config = loadConfig({
       settingsPath,
       env: {
         ANTHROPIC_AUTH_TOKEN: 'env-token',
         ANTHROPIC_MODEL: 'env-model',
       },
       headers: {
         'x-plugin-secret-anthropic-auth-token': 'header-token',
         'x-plugin-secret-anthropic-model': 'header-model',
       },
     });
     expect(config.apiKey).toBe('settings-token');
     expect(config.model).toBe('settings-model');
     tmp.cleanup();
   });

   it('uses default model when none is provided', () => {
     const config = loadConfig({
       settingsPath: '/nonexistent/settings.json',
       env: { ANTHROPIC_AUTH_TOKEN: 'token' },
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
     ).toThrow(/ANTHROPIC_AUTH_TOKEN/);
   });
 });
