import { describe, expect, test } from "bun:test";
import {
  AGENT_MOUNT_V1_CONFORMANCE_CASES,
  AgentMountConformanceError,
  assertAgentMountV1Conformance,
  createAgentMountV1CompileConformanceExecutors,
  createAgentMountV1ReferenceFixture,
  runAgentMountV1Conformance,
  type AgentMountV1ConformanceCase,
} from "../src/conformance.ts";
import { attachMountArtifactPublisher, linkAgentSource } from "../src/compiler.ts";

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
});
