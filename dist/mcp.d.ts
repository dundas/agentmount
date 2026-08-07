import { type EffectAuthorization, type EnvironmentManifest, type FunctionalityDefinition, type FunctionalityInvoker, type MountArtifact, type MountReference, type ResolvedMountContext } from "./core.js";
export declare const AGENT_MOUNT_MCP_VERSION: "agent-mount.mcp/v1";
export interface McpToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
}
export interface McpToolRegistrar {
    registerTool(name: string, definition: {
        title: string;
        description: string;
        inputSchema: unknown;
    }, handler: (arguments_: Record<string, unknown>) => Promise<McpToolResult>): void;
}
export interface AgentMountMcpDependencies {
    manifest: EnvironmentManifest;
    artifact: MountArtifact;
    verifyArtifactSignature(input: {
        keyId: string;
        digest: string;
        signature: string;
    }): Promise<boolean>;
    server: McpToolRegistrar;
    /** Connection-bound reference; never derive it from tool arguments. */
    mount: MountReference;
    resolveContext(reference: MountReference): Promise<ResolvedMountContext>;
    invoker: FunctionalityInvoker;
    resolveEffectAuthorization?(input: {
        context: ResolvedMountContext;
        functionality: FunctionalityDefinition;
        bindingDigest: string;
    }): Promise<EffectAuthorization | undefined>;
    /** Explicit adapter key inventory; required even when intentionally empty. */
    adapterSigningKeyIds: readonly string[];
    redactError?(error: unknown): string;
}
/** Async because manifest integrity is verified before any tool is registered. */
export declare function registerAgentMountMcpToolsAsync(dependencies: AgentMountMcpDependencies): Promise<readonly string[]>;
