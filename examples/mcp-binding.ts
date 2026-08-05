import {
  registerAgentMountMcpToolsAsync,
  type McpToolRegistrar,
} from "@agentmount/contracts/mcp";
import type {
  EffectAuthorization,
  EnvironmentManifest,
  FunctionalityDefinition,
  FunctionalityInvoker,
  MountArtifact,
  MountReference,
  ResolvedMountContext,
} from "@agentmount/contracts";

/**
 * Framework-neutral MCP skeleton. Adapt your MCP SDK's registerTool method to
 * McpToolRegistrar; keep connection and effect credentials outside tool args.
 */
export async function registerEnvironmentTools(input: {
  server: McpToolRegistrar;
  manifest: EnvironmentManifest;
  artifact: MountArtifact;
  verifyArtifactSignature(request: { keyId: string; digest: string; signature: string }): Promise<boolean>;
  connectionMount: MountReference;
  resolveMount(reference: MountReference): Promise<ResolvedMountContext>;
  invoker: FunctionalityInvoker;
  resolveEffectAuthorization(request: {
    context: ResolvedMountContext;
    functionality: FunctionalityDefinition;
    bindingDigest: string;
  }): Promise<EffectAuthorization | undefined>;
  /** Enumerate every signing key available to this adapter; empty is explicit. */
  adapterSigningKeyIds: readonly string[];
}) {
  return await registerAgentMountMcpToolsAsync({
    server: input.server,
    manifest: input.manifest,
    artifact: input.artifact,
    verifyArtifactSignature: input.verifyArtifactSignature,
    mount: input.connectionMount,
    resolveContext: input.resolveMount,
    invoker: input.invoker,
    resolveEffectAuthorization: input.resolveEffectAuthorization,
    adapterSigningKeyIds: input.adapterSigningKeyIds,
    // Return stable public text; log safe correlation details separately.
    redactError: (error) => error instanceof Error ? error.name : "AgentMountError",
  });
}
