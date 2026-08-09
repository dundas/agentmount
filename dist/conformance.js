// src/conformance.ts
var AGENT_MOUNT_V1_CONFORMANCE_CASES = [
  "compile.link_narrows",
  "compile.deterministic_artifact_digest",
  "compile.manifest_digest_binds_exports",
  "compile.artifact_hygiene",
  "authority.ungranted_functionality_denied",
  "authority.revoked_mount_denied_before_effect",
  "authority.stale_run_generation_denied",
  "authority.forged_context_denied",
  "authority.broker_adapter_key_separation",
  "authority.argument_tampering_denied",
  "authority.irreversible_requires_l4_native",
  "replay.idempotent_turn",
  "replay.generation_cursor",
  "replay.persist_before_fanout",
  "intent.pending_becomes_indeterminate"
];

class AgentMountConformanceError extends Error {
  result;
  constructor(result) {
    const failed = result.cases.filter(({ status }) => status === "failed").map(({ id }) => id);
    super(`AgentMount v1 conformance failed for ${result.environmentId}: ${failed.join(", ")}`);
    this.result = result;
    this.name = "AgentMountConformanceError";
  }
}
async function runAgentMountV1Conformance(suite) {
  if (typeof suite.environmentId !== "string" || suite.environmentId.length === 0) {
    throw new TypeError("AgentMount conformance requires a non-empty environmentId");
  }
  const missing = AGENT_MOUNT_V1_CONFORMANCE_CASES.filter((id) => typeof suite.cases?.[id] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`AgentMount conformance suite is missing case executors: ${missing.join(", ")}`);
  }
  const cases = [];
  for (const id of AGENT_MOUNT_V1_CONFORMANCE_CASES) {
    try {
      await suite.cases[id]();
      cases.push({ id, status: "passed" });
    } catch (error) {
      cases.push({ id, status: "failed", error });
    }
  }
  return { environmentId: suite.environmentId, passed: cases.every(({ status }) => status === "passed"), cases };
}
async function assertAgentMountV1Conformance(suite) {
  const result = await runAgentMountV1Conformance(suite);
  if (!result.passed)
    throw new AgentMountConformanceError(result);
  return result;
}
export {
  runAgentMountV1Conformance,
  assertAgentMountV1Conformance,
  AgentMountConformanceError,
  AGENT_MOUNT_V1_CONFORMANCE_CASES
};
