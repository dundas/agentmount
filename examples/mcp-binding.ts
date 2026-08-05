import {
  registerAgentMountMcpTools,
  type McpToolRegistrar,
} from "@agentmount/contracts/mcp";
import type {
  EffectAuthorization,
  EnvironmentManifest,
  FunctionalityDefinition,
  FunctionalityInvoker,
  MountReference,
  ResolvedMountContext,
} from "@agentmount/contracts";

/**
 * Framework-neutral MCP skeleton. Adapt your MCP SDK's registerTool method to
 * McpToolRegistrar; keep connection and effect credentials outside tool args.
 */
export function registerEnvironmentTools(input: {
  server: McpToolRegistrar;
  manifest: EnvironmentManifest;
  connectionMount: MountReference;
  resolveMount(reference: MountReference): Promise<ResolvedMountContext>;
  invoker: FunctionalityInvoker;
  resolveEffectAuthorization(request: {
    context: ResolvedMountContext;
    functionality: FunctionalityDefinition;
    bindingDigest: string;
  }): Promise<EffectAuthorization | undefined>;
}) {
  return registerAgentMountMcpTools({
    server: input.server,
    manifest: input.manifest,
    mount: input.connectionMount,
    resolveContext: input.resolveMount,
    invoker: input.invoker,
    resolveEffectAuthorization: input.resolveEffectAuthorization,
    // Return stable public text; log safe correlation details separately.
    redactError: (error) => error instanceof Error ? error.name : "AgentMountError",
  });
}
