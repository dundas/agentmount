import { describe, expect, test } from "bun:test";
import {
  AGENT_MOUNT_V1_CONFORMANCE_CASES,
  AgentMountConformanceError,
  assertAgentMountV1Conformance,
  runAgentMountV1Conformance,
  type AgentMountV1ConformanceCase,
} from "../src/conformance.ts";

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
});
