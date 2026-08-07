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
export {
  AGENT_MOUNT_V1_CONFORMANCE_CASES
};
