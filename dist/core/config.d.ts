import type { LLMConfig } from './types.js';
export interface ConfigOptions {
    projectPath?: string;
    settingsPath?: string;
    env?: NodeJS.ProcessEnv;
    headers?: Record<string, string | string[] | undefined>;
}
export declare function loadConfig(options?: ConfigOptions): LLMConfig;
export declare function redactApiKey(value: string, apiKey: string): string;
//# sourceMappingURL=config.d.ts.map