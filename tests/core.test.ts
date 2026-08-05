import { describe, expect, test } from "bun:test";
import {
  AgentMountError,
  argumentBindingDigest,
  assertDomainArguments,
  assertEffectAuthorizationBinding,
  assertFunctionalityDefinition,
  canonicalJson,
} from "../src/core.ts";

describe("core contract", () => {
  test("canonicalizes object keys and produces a stable digest", async () => {
    expect(canonicalJson({ z: 1, a: [true, "x"] })).toBe('{"a":[true,"x"],"z":1}');
    expect(await argumentBindingDigest({ b: 2, a: 1 })).toBe(await argumentBindingDigest({ a: 1, b: 2 }));
  });

  test("rejects authority smuggling in domain arguments", () => {
    expect(() => assertDomainArguments({ symbol: "ABC", mountId: "forged" })).toThrow(AgentMountError);
    expect(() => assertDomainArguments({ order: { principal_id: "forged" } })).toThrow(AgentMountError);
    expect(() => assertDomainArguments({ runtime_session_generation: 2 })).toThrow(AgentMountError);
    expect(() => assertDomainArguments({ client_turn_id: "forged" })).toThrow(AgentMountError);
  });

  test("requires intent deadlines and L4 for irreversible effects", () => {
    expect(() => assertFunctionalityDefinition({
      id: "trade.execute", kind: "effect", title: "Trade", description: "Trade",
      inputSchema: {}, approvalMode: "environment", reversible: false,
      idempotencyRequired: true, minimumConformanceLevel: "L3",
    })).toThrow("requires intentResolutionDeadlineMs");
    expect(() => assertFunctionalityDefinition({
      id: "trade.execute", kind: "effect", title: "Trade", description: "Trade",
      inputSchema: {}, approvalMode: "environment", reversible: false,
      idempotencyRequired: true, intentResolutionDeadlineMs: 30_000, minimumConformanceLevel: "L3",
    })).toThrow("must require L4");
    expect(() => assertFunctionalityDefinition({
      id: "test.effect", kind: "effect", title: "Effect", description: "Effect",
      inputSchema: {}, approvalMode: "environment", reversible: true,
      idempotencyRequired: false, intentResolutionDeadlineMs: 30_000, minimumConformanceLevel: "L3",
    })).toThrow("requires idempotency");
  });

  test("binds effect authority to run generation and requires explicit broker key inventory", () => {
    const context = {
      protocolVersion: "agent-mount/v1", mountId: "mount_test", environmentId: "env_test",
      environmentAccountId: "account_test", agentId: "agent_test", releaseId: "release_test",
      artifactDigest: "artifact_test",
      principalId: "principal_test", adapterDigest: "adapter_test", policyVersion: "policy_test",
      mountEpoch: 2, threadId: "thread_test", runId: "run_test", runGeneration: 4, traceId: "trace_test",
    } as const;
    const functionality = {
      id: "test.effect", kind: "effect", title: "Effect", description: "Effect",
      inputSchema: {}, approvalMode: "environment", reversible: true, idempotencyRequired: true,
      intentResolutionDeadlineMs: 30_000, minimumConformanceLevel: "L3",
    } as const;
    const authorization = {
      authorizationId: "authorization_test", authorizerKind: "mount_broker", argumentBinding: "broker_attested",
      bindingDigest: "binding_test", mountId: context.mountId, mountEpoch: context.mountEpoch,
      runGeneration: context.runGeneration - 1, functionalityId: functionality.id,
      principalId: context.principalId, expiresAt: "2099-01-01T00:00:00.000Z", assurance: "aal2",
      attestation: { keyId: "broker_key", signature: "signature_test" },
    } as const;
    expect(() => assertEffectAuthorizationBinding({
      authorization, context, functionality, bindingDigest: "binding_test", adapterSigningKeyIds: [],
    })).toThrow("run_generation_stale");

    const current = { ...authorization, runGeneration: context.runGeneration };
    expect(() => assertEffectAuthorizationBinding({
      authorization: { ...current, mountEpoch: context.mountEpoch - 1 },
      context, functionality, bindingDigest: "binding_test", adapterSigningKeyIds: [],
    })).toThrow("mount_epoch_stale");
    expect(() => assertEffectAuthorizationBinding({
      authorization: current, context, functionality, bindingDigest: "binding_test",
      // Runtime negative fixture: JavaScript callers cannot make the key check disappear.
      adapterSigningKeyIds: undefined as never,
    })).toThrow("explicit adapter key inventory");

    expect(() => assertEffectAuthorizationBinding({
      authorization: current,
      context,
      functionality: { ...functionality, reversible: false, minimumConformanceLevel: "L4" },
      bindingDigest: "binding_test",
      adapterSigningKeyIds: [],
    })).toThrow("environment-native authorizer");
  });
});
