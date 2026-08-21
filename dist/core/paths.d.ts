import type { LogProvider } from './types.js';
export declare function encodeProjectPath(projectPath: string): string;
export interface ResolvedLogPath {
    logPath: string;
    realSessionId: string;
    provider: LogProvider;
}
export interface SessionLogResolutionOptions {
    projectsDir?: string;
    cloudcliDbPath?: string;
    codexHome?: string;
    claudeSessionsDir?: string;
}
export interface ClaudeLogResolutionOptions {
    projectsDir?: string;
    sessionsDir?: string;
    knownLogPath?: string;
}
export interface CodexLogResolutionOptions {
    codexHome?: string;
    knownLogPath?: string;
}
export declare function resolveLogPath(projectPath: string, sessionId: string, projectsDir?: string): string;
export declare function resolveCodexSessionLogPath(sessionId: string, options?: CodexLogResolutionOptions): Promise<ResolvedLogPath | undefined>;
export declare function resolveClaudeSessionLogPath(projectPath: string, sessionId: string, options?: ClaudeLogResolutionOptions): ResolvedLogPath | undefined;
export declare function resolveSessionLogPath(projectPath: string, cloudcliSessionId: string, options?: string | SessionLogResolutionOptions): Promise<ResolvedLogPath>;
//# sourceMappingURL=paths.d.ts.map