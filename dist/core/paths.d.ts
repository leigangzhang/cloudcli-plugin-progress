export declare function encodeProjectPath(projectPath: string): string;
export interface ResolvedLogPath {
    logPath: string;
    realSessionId: string;
}
export declare function resolveLogPath(projectPath: string, sessionId: string, projectsDir?: string): string;
export declare function resolveSessionLogPath(projectPath: string, cloudcliSessionId: string, projectsDir?: string): Promise<ResolvedLogPath>;
//# sourceMappingURL=paths.d.ts.map