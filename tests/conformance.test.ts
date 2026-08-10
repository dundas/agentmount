import { describe, expect, test } from "bun:test";
import {
  AGENT_MOUNT_V1_CONFORMANCE_CASES,
  AgentMountConformanceError,
  assertAgentMountV1Conformance,
  createAgentMountV1CompileConformanceExecutors,
  createAgentMountV1IrreversibleEffectConformanceExecutors,
  createAgentMountV1ReferenceFixture,
  runAgentMountV1Conformance,
  type AgentMountV1ConformanceCase,
} from "../src/conformance.ts";
import { attachMountArtifactPublisher, linkAgentSource } from "../src/compiler.ts";
import { AgentMountError, argumentBindingDigest, assertEffectAuthorizationBinding } from "../src/core.ts";

function suite(overrides: Partial<Record<AgentMountV1ConformanceCase, () => void | Promise<void>>> = {}) {
  return {
    environmentId: "test-environment",
    cases: Object.fromEntries(AGENT_MOUNT_V1_CONFORMANCE_CASES.map((id) => [id, overrides[id] ?? (() => {})])) as Record<
      AgentMountV1ConformanceCase,
      () => void | Promise<void>
    >,
  };
}

describe("AgentMount v1 conformance runner", () => {
  test("runs every required case in the published deterministic order", async () => {
    const executed: string[] = [];
    const result = await assertAgentMountV1Conformance(suite(Object.fromEntries(
      AGENT_MOUNT_V1_CONFORMANCE_CASES.map((id) => [id, () => { executed.push(id); }]),
    )));

    expect(result.passed).toBe(true);
    expect(executed).toEqual([...AGENT_MOUNT_V1_CONFORMANCE_CASES]);
    expect(result.cases.map(({ id, status }) => ({ id, status }))).toEqual(
      AGENT_MOUNT_V1_CONFORMANCE_CASES.map((id) => ({ id, status: "passed" })),
    );
  });

  test("rejects an incomplete suite before executing any case", async () => {
    const incomplete = suite();
    delete (incomplete.cases as Partial<typeof incomplete.cases>)["authority.forged_context_denied"];

    await expect(runAgentMountV1Conformance(incomplete as never)).rejects.toThrow("missing case executors");
  });

  test("collects all failures and exposes them through the assertion error", async () => {
    const result = await runAgentMountV1Conformance(suite({
      "compile.link_narrows": () => { throw new Error("linking failure"); },
      "authority.revoked_mount_denied_before_effect": () => { throw new Error("revocation failure"); },
    }));
    expect(result.passed).toBe(false);
    expect(result.cases.filter(({ status }) => status === "failed").map(({ id }) => id)).toEqual([
      "compile.link_narrows",
      "authority.revoked_mount_denied_before_effect",
    ]);
    await expect(assertAgentMountV1Conformance(suite({
      "compile.link_narrows": () => { throw new Error("linking failure"); },
    }))).rejects.toBeInstanceOf(AgentMountConformanceError);
  });

  test("ships four reusable compile assertions that pass against the reference compiler", async () => {
    const fixture = await createAgentMountV1ReferenceFixture();
    const compile = async (source = fixture.source, manifest = fixture.manifest) =>
      attachMountArtifactPublisher(await linkAgentSource(source, manifest), { keyId: "reference", signature: "reference" });
    const executors = createAgentMountV1CompileConformanceExecutors(fixture, { compile });

    for (const executor of Object.values(executors)) await executor();
  });

  test("compile assertions reject an adapter that widens linked functionality", async () => {
    const fixture = await createAgentMountV1ReferenceFixture();
    const executors = createAgentMountV1CompileConformanceExecutors(fixture, {
      compile: async (source, manifest) => {
        if (source.requestedFunctionality.includes("conformance.unavailable")) {
          return attachMountArtifactPublisher(await linkAgentSource(source, manifest), { keyId: "reference", signature: "reference" });
        }
        const artifact = await attachMountArtifactPublisher(await linkAgentSource(
          source, manifest,
        ), { keyId: "reference", signature: "reference" });
        return { ...artifact, linkedFunctionality: [...artifact.linkedFunctionality, "conformance.unavailable"] };
      },
    });

    await expect(executors["compile.link_narrows"]()).rejects.toThrow("Linked functionality");
  });

  test("L4 executor denies a broker-authorized irreversible effect", async () => {
    const fixture = await createAgentMountV1ReferenceFixture();
    const executors = createAgentMountV1IrreversibleEffectConformanceExecutors(fixture, {
      compile: async (source, manifest) =>
        attachMountArtifactPublisher(await linkAgentSource(source, manifest), { keyId: "reference", signature: "reference" }),
      activate: async (artifact) => ({
        protocolVersion: "agent-mount/v1", mountId: "mount_reference", environmentId: fixture.manifest.environmentId,
        environmentAccountId: "account_reference", agentId: fixture.source.agentId, releaseId: "release_reference",
        artifactDigest: artifact.artifactDigest, principalId: "principal_reference", adapterDigest: fixture.manifest.adapterDigest,
        policyVersion: "policy_reference", mountEpoch: 1, threadId: "thread_reference", runId: "run_reference",
        runGeneration: 1, traceId: "trace_reference",
      }),
      invokeEffect: async (input) => {
        try {
          assertEffectAuthorizationBinding({
            authorization: input.effectAuthorization,
            context: input.context,
            functionality: input.functionality,
            bindingDigest: await argumentBindingDigest(input.arguments),
            adapterSigningKeyIds: [],
          });
        } catch (error) {
          if (error instanceof AgentMountError) return { status: "denied", error: error.code, auditId: "audit_reference" };
          throw error;
        }
        return { status: "completed", output: {}, auditId: "audit_reference" };
      },
    }, { id: "reference_item" });

    await executors["authority.irreversible_requires_l4_native"]();
  });

  test("L4 executor rejects an adapter that skips effect-authorization binding", async () => {
    const fixture = await createAgentMountV1ReferenceFixture();
    const executors = createAgentMountV1IrreversibleEffectConformanceExecutors(fixture, {
      compile: async (source, manifest) =>
        attachMountArtifactPublisher(await linkAgentSource(source, manifest), { keyId: "reference", signature: "reference" }),
      activate: async (artifact) => ({
        protocolVersion: "agent-mount/v1", mountId: "mount_reference", environmentId: fixture.manifest.environmentId,
        environmentAccountId: "account_reference", agentId: fixture.source.agentId, releaseId: "release_reference",
        artifactDigest: artifact.artifactDigest, principalId: "principal_reference", adapterDigest: fixture.manifest.adapterDigest,
        policyVersion: "policy_reference", mountEpoch: 1, threadId: "thread_reference", runId: "run_reference",
        runGeneration: 1, traceId: "trace_reference",
      }),
      invokeEffect: async () => ({ status: "completed", output: {}, auditId: "audit_reference" }),
    }, { id: "reference_item" });

    await expect(executors["authority.irreversible_requires_l4_native"]()).rejects.toThrow("broker must be denied");
  });
});
