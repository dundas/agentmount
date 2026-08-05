import { describe, expect, test } from "bun:test";
import {
  AGENT_MOUNT_VERSION,
  type EnvironmentManifest,
  type FunctionalityInvocation,
  type ResolvedMountContext,
} from "../src/core.ts";
import { registerAgentMountMcpTools, type McpToolRegistrar, type McpToolResult } from "../src/mcp.ts";

const context: ResolvedMountContext = {
  protocolVersion: AGENT_MOUNT_VERSION,
  mountId: "mount_test", environmentId: "test", environmentAccountId: "account_test",
  agentId: "agent_test", releaseId: "release_test", principalId: "principal_test",
  adapterDigest: "sha256:test", policyVersion: "policy_test", mountEpoch: 4,
  threadId: "thread_test", runId: "run_test", runGeneration: 2, traceId: "trace_test",
};

function fixtureManifest(kind: "read" | "effect" = "read"): EnvironmentManifest {
  return {
    protocolVersion: AGENT_MOUNT_VERSION,
    environmentId: "test", adapterVersion: "1.0.0", adapterDigest: "sha256:test",
    bindings: { mcp: { version: "agent-mount.mcp/v1" } },
    functionality: [{
      id: "test.item.get", kind, title: "Get item", description: "Get one item", inputSchema: {},
      approvalMode: kind === "effect" ? "environment" : "none", reversible: true,
      idempotencyRequired: kind === "effect", ...(kind === "effect" ? { intentResolutionDeadlineMs: 30_000 } : {}),
      minimumConformanceLevel: kind === "effect" ? "L3" : "L0",
    }],
  };
}

describe("MCP binding", () => {
  test("uses connection-bound context and strips idempotency from domain arguments", async () => {
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    let invocation: FunctionalityInvocation | undefined;
    const server: McpToolRegistrar = { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } };
    registerAgentMountMcpTools({
      manifest: fixtureManifest(), server, mount: { mountId: context.mountId },
      resolveContext: async () => context,
      invoker: { invoke: async (input) => { invocation = input; return { status: "completed", output: { ok: true }, auditId: "audit_test" }; } },
    });
    const result = await handlers.get("test.item.get")?.({ itemId: "item_test", idempotencyKey: "idempotency_test_1" });
    expect(result?.isError).not.toBe(true);
    expect(invocation?.context.mountId).toBe(context.mountId);
    expect(invocation?.arguments).toEqual({ itemId: "item_test" });
  });

  test("rejects forged authority fields before invoking the environment", async () => {
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    let invoked = false;
    registerAgentMountMcpTools({
      manifest: fixtureManifest(),
      server: { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } },
      mount: { mountId: context.mountId }, resolveContext: async () => context,
      invoker: { invoke: async () => { invoked = true; return { status: "completed", output: {}, auditId: "audit_test" }; } },
    });
    const result = await handlers.get("test.item.get")?.({ mountId: "mount_forged" });
    expect(result?.structuredContent?.error).toBe("invalid_argument");
    expect(invoked).toBe(false);
  });

  test("does not treat an MCP connection as effect authorization", async () => {
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    registerAgentMountMcpTools({
      manifest: fixtureManifest("effect"),
      server: { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } },
      mount: { mountId: context.mountId }, resolveContext: async () => context,
      invoker: { invoke: async () => ({ status: "completed", output: {}, auditId: "audit_test" }) },
    });
    const result = await handlers.get("test.item.get")?.({ idempotencyKey: "idempotency_test_1" });
    expect(result?.structuredContent?.error).toBe("approval_required");
  });

  test("rejects a broker attestation signed by an adapter-held key", async () => {
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<McpToolResult>>();
    let invoked = false;
    registerAgentMountMcpTools({
      manifest: fixtureManifest("effect"),
      server: { registerTool: (name, _definition, handler) => { handlers.set(name, handler); } },
      mount: { mountId: context.mountId }, resolveContext: async () => context,
      adapterSigningKeyIds: ["adapter_key"],
      resolveEffectAuthorization: async ({ bindingDigest }) => ({
        authorizationId: "authorization_test", authorizerKind: "mount_broker",
        argumentBinding: "broker_attested", bindingDigest, mountId: context.mountId,
        mountEpoch: context.mountEpoch, functionalityId: "test.item.get",
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
