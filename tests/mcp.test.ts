import { describe, expect, test } from "bun:test";
import {
  AGENT_MOUNT_VERSION,
  type EnvironmentManifest,
  type FunctionalityInvocation,
  type ResolvedMountContext,
} from "../src/core.ts";
import {
  attachMountArtifactPublisher,
  computeEnvironmentManifestDigest,
  linkAgentSource,
} from "../src/compiler.ts";
import { registerAgentMountMcpToolsAsync, type McpToolRegistrar, type McpToolResult } from "../src/mcp.ts";

const context: ResolvedMountContext = {
  protocolVersion: AGENT_MOUNT_VERSION,
  mountId: "mount_test", environmentId: "test", environmentAccountId: "account_test",
  agentId: "agent_test", releaseId: "release_test", principalId: "principal_test",
  artifactDigest: "artifact_test",
  adapterDigest: "sha256:test", policyVersion: "policy_test", mountEpoch: 4,
  threadId: "thread_test", runId: "run_test", runGeneration: 2, traceId: "trace_test",
};

async function fixtureManifest(kind: "read" | "effect" = "read"): Promise<EnvironmentManifest> {
  const manifest: EnvironmentManifest = {
    protocolVersion: AGENT_MOUNT_VERSION,
    environmentId: "test", adapterVersion: "1.0.0", adapterDigest: "sha256:test",
    revocation: { profile: "synchronous" },
    bindings: { mcp: { version: "agent-mount.mcp/v1" } },
    functionality: [{
      id: "test.item.get", kind, title: "Get item", description: "Get one item", inputSchema: {},
      approvalMode: kind === "effect" ? "environment" : "none", reversible: true,
      idempotencyRequired: kind === "effect", ...(kind === "effect" ? { intentResolutionDeadlineMs: 30_000 } : {}),
      minimumConformanceLevel: kind === "effect" ? "L3" : "L0",
    }],
  };
  manifest.adapterDigest = await computeEnvironmentManifestDigest(manifest);
  return manifest;
}

async function fixtureArtifact(manifest: EnvironmentManifest) {
  const linked = await linkAgentSource({
    protocolVersion: AGENT_MOUNT_VERSION,
    agentId: context.agentId,
    sourceDigest: "source_test",
    instructions: "test",
    modelProfile: { family: "test", parameters: {} },
    requestedFunctionality: ["test.item.get"],
  }, manifest);
  return attachMountArtifactPublisher(linked, { keyId: "publisher_test", signature: "signature_test" });
}

const verifyArtifactSignature = async () => true;

describe("MCP binding", () => {
  test("rejects manifest drift and a missing adapter key inventory before registering tools", async () => {
    const manifest = await fixtureManifest();
    const artifact = await fixtureArtifact(manifest);
    const server: McpToolRegistrar = { registerTool: () => { throw new Error("must not register"); } };
    await expect(registerAgentMountMcpToolsAsync({
      manifest: { ...manifest, adapterVersion: "tampered" }, artifact, verifyArtifactSignature, server,
      mount: { mountId: context.mountId }, adapterSigningKeyIds: [],
      resolveContext: async () => context,
      invoker: { invoke: async () => ({ status: "completed", output: {}, auditId: "audit_test" }) },
    })).rejects.toThrow("manifest digest mismatch");
    await expect(registerAgentMountMcpToolsAsync({
      manifest, artifact, verifyArtifactSignature, server, mount: { mountId: context.mountId },
      adapterSigningKeyIds: undefined as never,
      resolveContext: async () => context,
      invoker: { invoke: async () => ({ status: "completed", output: {}, auditId: "audit_test" }) },
    })).rejects.toThrow("explicit adapter key inventory");
  });

  test("validates the complete manifest before exposing any tool", async () => {
    const manifest = await fixtureManifest();
    const artifact = await fixtureArtifact(manifest);
    const duplicated: EnvironmentManifest = {
      ...manifest,
      functionality: [...manifest.functionality, manifest.functionality[0]!],
      adapterDigest: "",
    };
    duplicated.adapterDigest = await computeEnvironmentManifestDigest(duplicated);
    let registrations = 0;
    await expect(registerAgentMountMcpToolsAsync({
      manifest: duplicated,
      artifact, verifyArtifactSignature,
      server: { registerTool: () => { registrations += 1; } },
      mount: { mountId: context.mountId }, adapterSigningKeyIds: [],
      resolveContext: async () => context,
      invoker: { invoke: async () => ({ status: "completed", output: {}, auditId: "audit_test" }) },
    })).rejects.toThrow("Duplicate functionality");
    expect(registrations).toBe(0);
  });

  test("registers only functionality linked into the compiled artifact", async () => {
    const base = await fixtureManifest();
    const manifest: EnvironmentManifest = {
      ...base,
      functionality: [...base.functionality, {
        ...base.functionality[0]!, id: "test.item.list", title: "List items",
      }],
      adapterDigest: "",
    };
    manifest.adapterDigest = await computeEnvironmentManifestDigest(manifest);
    const artifact = await fixtureArtifact(manifest);
    const registered: string[] = [];
    const names = await registerAgentMountMcpToolsAsync({
      manifest, artifact, verifyArtifactSignature,
      server: { registerTool: (name) => { registered.push(name); } },
      mount: { mountId: context.mountId }, adapterSigningKeyIds: [],
      resolveContext: async () => context,
      invoker: { invoke: async () => ({ status: "completed", output: {}, auditId: "audit_test" }) },
    });
    expect(names).toEqual(["test.item.get"]);
    expect(registered).toEqual(["test.item.get"]);
  });

  test("uses connection-bound context and strips idempotency from domain arguments", async () => {
    const manifest = await fixtureManifest();
    const artifact = await fixtureArtifact(manifest);
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    let invocation: FunctionalityInvocation | undefined;
    const server: McpToolRegistrar = { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } };
    await registerAgentMountMcpToolsAsync({
      manifest, artifact, verifyArtifactSignature, server, mount: { mountId: context.mountId },
      adapterSigningKeyIds: [],
      resolveContext: async () => ({ ...context, artifactDigest: artifact.artifactDigest, adapterDigest: manifest.adapterDigest }),
      invoker: { invoke: async (input) => { invocation = input; return { status: "completed", output: { ok: true }, auditId: "audit_test" }; } },
    });
    const result = await handlers.get("test.item.get")?.({ itemId: "item_test", idempotencyKey: "idempotency_test_1" });
    expect(result?.isError).not.toBe(true);
    expect(invocation?.context.mountId).toBe(context.mountId);
    expect(invocation?.arguments).toEqual({ itemId: "item_test" });
  });

  test("rejects forged authority fields before invoking the environment", async () => {
    const manifest = await fixtureManifest();
    const artifact = await fixtureArtifact(manifest);
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    let invoked = false;
    await registerAgentMountMcpToolsAsync({
      manifest, artifact, verifyArtifactSignature,
      server: { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } },
      mount: { mountId: context.mountId }, resolveContext: async () => ({ ...context, artifactDigest: artifact.artifactDigest, adapterDigest: manifest.adapterDigest }),
      adapterSigningKeyIds: [],
      invoker: { invoke: async () => { invoked = true; return { status: "completed", output: {}, auditId: "audit_test" }; } },
    });
    const result = await handlers.get("test.item.get")?.({ mountId: "mount_forged" });
    expect(result?.structuredContent?.error).toBe("invalid_argument");
    expect(invoked).toBe(false);
  });

  test("does not treat an MCP connection as effect authorization", async () => {
    const manifest = await fixtureManifest("effect");
    const artifact = await fixtureArtifact(manifest);
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    await registerAgentMountMcpToolsAsync({
      manifest, artifact, verifyArtifactSignature,
      server: { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } },
      mount: { mountId: context.mountId }, resolveContext: async () => ({ ...context, artifactDigest: artifact.artifactDigest, adapterDigest: manifest.adapterDigest }),
      adapterSigningKeyIds: [],
      invoker: { invoke: async () => ({ status: "completed", output: {}, auditId: "audit_test" }) },
    });
    const result = await handlers.get("test.item.get")?.({ idempotencyKey: "idempotency_test_1" });
    expect(result?.structuredContent?.error).toBe("approval_required");
  });

  test("rejects an idempotency key longer than the MCP schema limit before authorization", async () => {
    const manifest = await fixtureManifest("effect");
    const artifact = await fixtureArtifact(manifest);
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    await registerAgentMountMcpToolsAsync({
      manifest, artifact, verifyArtifactSignature,
      server: { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } },
      mount: { mountId: context.mountId }, resolveContext: async () => ({ ...context, artifactDigest: artifact.artifactDigest, adapterDigest: manifest.adapterDigest }),
      adapterSigningKeyIds: [],
      invoker: { invoke: async () => ({ status: "completed", output: {}, auditId: "audit_test" }) },
    });
    const result = await handlers.get("test.item.get")?.({ idempotencyKey: "a".repeat(129) });
    expect(result?.structuredContent?.error).toBe("invalid_argument");
  });

  test("rejects a broker attestation signed by an adapter-held key", async () => {
    const manifest = await fixtureManifest("effect");
    const artifact = await fixtureArtifact(manifest);
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    let invoked = false;
    await registerAgentMountMcpToolsAsync({
      manifest, artifact, verifyArtifactSignature,
      server: { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } },
      mount: { mountId: context.mountId }, resolveContext: async () => ({ ...context, artifactDigest: artifact.artifactDigest, adapterDigest: manifest.adapterDigest }),
      adapterSigningKeyIds: ["adapter_key"],
      resolveEffectAuthorization: async ({ bindingDigest }) => ({
        authorizationId: "authorization_test", authorizerKind: "mount_broker",
        argumentBinding: "broker_attested", bindingDigest, mountId: context.mountId,
        mountEpoch: context.mountEpoch, runGeneration: context.runGeneration, functionalityId: "test.item.get",
        principalId: context.principalId, expiresAt: "2099-01-01T00:00:00.000Z",
        assurance: "aal2_reauth_bound", attestation: { keyId: "adapter_key", signature: "signature_test" },
      }),
      invoker: { invoke: async () => { invoked = true; return { status: "completed", output: {}, auditId: "audit_test" }; } },
    });
    const result = await handlers.get("test.item.get")?.({ idempotencyKey: "idempotency_test_1" });
    expect(result?.structuredContent?.error).toBe("authorization_invalid");
    expect(invoked).toBe(false);
  });
});
