// src/mcp.ts
import {
  AgentMountError,
  argumentBindingDigest,
  assertDomainArguments,
  assertEffectAuthorizationBinding,
  assertFunctionalityDefinition
} from "./core.js";
import { assertEnvironmentManifestDigest, verifyMountArtifact } from "./compiler.js";
var AGENT_MOUNT_MCP_VERSION = "agent-mount.mcp/v1";
async function registerAgentMountMcpToolsAsync(dependencies) {
  await assertEnvironmentManifestDigest(dependencies.manifest);
  await verifyMountArtifact(dependencies.artifact, dependencies.verifyArtifactSignature);
  if (dependencies.artifact.environmentId !== dependencies.manifest.environmentId || dependencies.artifact.adapterDigest !== dependencies.manifest.adapterDigest) {
    throw new AgentMountError("mount_inactive", "Compiled artifact does not target the registered manifest");
  }
  if (!Array.isArray(dependencies.adapterSigningKeyIds)) {
    throw new AgentMountError("invalid_argument", "An explicit adapter key inventory is required");
  }
  if (dependencies.manifest.bindings.mcp?.version !== AGENT_MOUNT_MCP_VERSION) {
    throw new AgentMountError("unsupported_binding");
  }
  const names = new Set;
  for (const functionality of dependencies.manifest.functionality) {
    assertFunctionalityDefinition(functionality);
    if (names.has(functionality.id))
      throw new AgentMountError("invalid_argument", `Duplicate functionality: ${functionality.id}`);
    names.add(functionality.id);
  }
  const linked = new Set(dependencies.artifact.linkedFunctionality);
  for (const id of linked) {
    if (!names.has(id))
      throw new AgentMountError("functionality_denied", `Compiled functionality is absent from the manifest: ${id}`);
  }
  const artifactDigest = dependencies.artifact.artifactDigest;
  for (const functionality of dependencies.manifest.functionality.filter(({ id }) => linked.has(id))) {
    dependencies.server.registerTool(functionality.id, {
      title: functionality.title,
      description: functionality.description,
      inputSchema: functionality.inputSchema
    }, async (arguments_) => invokeTool(dependencies, functionality, arguments_, artifactDigest));
  }
  return [...linked].sort();
}
async function invokeTool(dependencies, functionality, rawArguments, artifactDigest) {
  try {
    assertDomainArguments(rawArguments);
    const context = await dependencies.resolveContext(dependencies.mount);
    if (context.artifactDigest !== artifactDigest) {
      throw new AgentMountError("mount_inactive", "Active mount does not match the registered compiled artifact");
    }
    if (context.adapterDigest !== dependencies.manifest.adapterDigest) {
      throw new AgentMountError("mount_inactive", "Active adapter digest does not match the registered manifest");
    }
    const { idempotencyKey, ...domainArguments } = rawArguments;
    if (functionality.idempotencyRequired && (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)) {
      throw new AgentMountError("invalid_argument", "A stable idempotencyKey of at least 16 characters is required");
    }
    const bindingDigest = await argumentBindingDigest(domainArguments);
    const effectAuthorization = functionality.kind === "effect" ? await dependencies.resolveEffectAuthorization?.({ context, functionality, bindingDigest }) : undefined;
    if (functionality.kind === "effect" && !effectAuthorization) {
      throw new AgentMountError("approval_required");
    }
    if (effectAuthorization) {
      assertEffectAuthorizationBinding({
        authorization: effectAuthorization,
        context,
        functionality,
        bindingDigest,
        adapterSigningKeyIds: dependencies.adapterSigningKeyIds
      });
    }
    const outcome = await dependencies.invoker.invoke({
      context,
      functionality,
      arguments: domainArguments,
      ...typeof idempotencyKey === "string" ? { idempotencyKey } : {},
      bindingDigest,
      transport: "mcp",
      ...effectAuthorization ? { effectAuthorization } : {}
    });
    return outcomeResult(outcome);
  } catch (error) {
    const code = error instanceof AgentMountError ? error.code : "environment_unavailable";
    const message = dependencies.redactError?.(error) ?? code;
    return {
      isError: true,
      content: [{ type: "text", text: message }],
      structuredContent: { version: AGENT_MOUNT_MCP_VERSION, ok: false, error: code }
    };
  }
}
function outcomeResult(outcome) {
  if (outcome.status === "completed") {
    return {
      content: [{ type: "text", text: "Functionality completed" }],
      structuredContent: { version: AGENT_MOUNT_MCP_VERSION, ok: true, ...outcome }
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: outcome.error }],
    structuredContent: { version: AGENT_MOUNT_MCP_VERSION, ok: false, ...outcome }
  };
}
export {
  registerAgentMountMcpToolsAsync,
  AGENT_MOUNT_MCP_VERSION
};
