// src/conformance.ts
import {
  AgentMountError,
  AGENT_MOUNT_VERSION
} from "./core.js";
import {
  assertArtifactHygiene,
  assertEnvironmentManifestDigest,
  attachMountArtifactPublisher,
  computeEnvironmentManifestDigest,
  computeMountArtifactDigest,
  linkAgentSource,
  verifyMountArtifact
} from "./compiler.js";
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

class ConformanceNotImplemented extends Error {
  method;
  constructor(method) {
    super(`adapter method not implemented: ${method}`);
    this.name = "ConformanceNotImplemented";
    this.method = method;
  }
}
async function runConformanceCase(name, fixture, adapter) {
  try {
    switch (name) {
      case "compile.link_narrows": {
        const unexported = {
          ...fixture.source,
          requestedFunctionality: [...fixture.source.requestedFunctionality, "not.exported"]
        };
        await expectRejects(() => adapter.compile(unexported, fixture.manifest), (e) => e instanceof AgentMountError && e.code === "functionality_denied", "compile of an unexported functionality must be denied");
        const artifact = await adapter.compile(fixture.source, fixture.manifest);
        const exported = new Set(fixture.manifest.functionality.map((f) => f.id));
        for (const id of artifact.linkedFunctionality) {
          if (!exported.has(id)) {
            throw new ConformanceAssertionError(`linkedFunctionality contains unexported id: ${id}`);
          }
        }
        return { case: name, status: "pass" };
      }
      case "compile.deterministic_artifact_digest": {
        const a = await adapter.compile(fixture.source, fixture.manifest);
        const b = await adapter.compile(fixture.source, fixture.manifest);
        if (a.artifactDigest !== b.artifactDigest) {
          throw new ConformanceAssertionError("artifactDigest is not deterministic");
        }
        const published = await attachMountArtifactPublisher(a, { keyId: "k", signature: "s" });
        if (published.artifactDigest !== a.artifactDigest) {
          throw new ConformanceAssertionError("attaching a publisher changed artifactDigest");
        }
        return { case: name, status: "pass" };
      }
      case "compile.manifest_digest_binds_exports": {
        const tampered = {
          ...fixture.manifest,
          functionality: [...fixture.manifest.functionality, fixture.reversibleEffect]
        };
        await expectRejects(() => adapter.compile(fixture.source, tampered), (e) => e instanceof AgentMountError && (e.code === "invalid_argument" || e.code === "mount_inactive"), "compile against a manifest with a stale adapterDigest must be denied");
        return { case: name, status: "pass" };
      }
      case "compile.artifact_hygiene": {
        const dirty = {
          ...fixture.source,
          grant: "should-be-forbidden"
        };
        await expectRejects(() => adapter.compile(dirty, fixture.manifest), (e) => e instanceof AgentMountError && e.code === "invalid_argument", "a source with a forbidden authority field must fail hygiene");
        return { case: name, status: "pass" };
      }
      case "authority.ungranted_functionality_denied":
      case "authority.revoked_mount_denied_before_effect":
      case "authority.stale_run_generation_denied":
      case "authority.forged_context_denied":
      case "authority.broker_adapter_key_separation":
      case "authority.argument_tampering_denied":
      case "authority.irreversible_requires_l4_native":
      case "replay.idempotent_turn":
      case "replay.generation_cursor":
      case "replay.persist_before_fanout":
      case "intent.pending_becomes_indeterminate":
        return { case: name, status: "not_applicable", reason: "runner case not yet implemented (slice 1.5)" };
      default: {
        const _exhaustive = name;
        return { case: name, status: "not_applicable", reason: `unhandled case: ${String(_exhaustive)}` };
      }
    }
  } catch (error) {
    if (error instanceof ConformanceNotImplemented) {
      return { case: name, status: "not_applicable", reason: error.message };
    }
    if (error instanceof ConformanceAssertionError) {
      return { case: name, status: "fail", reason: error.message };
    }
    return {
      case: name,
      status: "fail",
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    };
  }
}
async function runConformance(fixture, adapter) {
  const results = [];
  for (const name of AGENT_MOUNT_V1_CONFORMANCE_CASES) {
    results.push(await runConformanceCase(name, fixture, adapter));
  }
  return {
    results,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    notApplicable: results.filter((r) => r.status === "not_applicable").length
  };
}
async function referenceFixture() {
  const reversibleEffect = {
    id: "ref.item.upsert",
    kind: "proposal",
    title: "Upsert item",
    description: "Create or update an item.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1 } } },
    approvalMode: "none",
    reversible: true,
    idempotencyRequired: true,
    minimumConformanceLevel: "L2"
  };
  const irreversibleEffect = {
    id: "ref.item.publish",
    kind: "effect",
    title: "Publish item",
    description: "Irreversibly publish an item.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 } } },
    approvalMode: "environment",
    reversible: false,
    idempotencyRequired: true,
    intentResolutionDeadlineMs: 30000,
    minimumConformanceLevel: "L4"
  };
  const read = {
    id: "ref.item.get",
    kind: "read",
    title: "Get item",
    description: "Read one item.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 } } },
    approvalMode: "none",
    reversible: true,
    idempotencyRequired: false,
    minimumConformanceLevel: "L0"
  };
  const base = {
    protocolVersion: AGENT_MOUNT_VERSION,
    environmentId: "environment_reference",
    adapterVersion: "0.1.0-draft.1",
    revocation: { profile: "synchronous" },
    functionality: [read, reversibleEffect, irreversibleEffect],
    bindings: { chat: { version: "agent-mount.chat/v1" }, mcp: { version: "agent-mount.mcp/v1" } }
  };
  const adapterDigest = await computeEnvironmentManifestDigest(base);
  const manifest = { ...base, adapterDigest };
  const source = {
    protocolVersion: AGENT_MOUNT_VERSION,
    agentId: "agent_reference",
    sourceDigest: "source_reference",
    instructions: "Reference agent for the product-neutral conformance fixture.",
    modelProfile: { family: "portable", parameters: { temperature: 0 } },
    requestedFunctionality: [read.id, reversibleEffect.id]
  };
  return { source, manifest, reversibleEffect, irreversibleEffect };
}

class ConformanceAssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConformanceAssertionError";
  }
}
async function expectRejects(fn, predicate, message) {
  try {
    await fn();
  } catch (error) {
    if (!predicate(error)) {
      throw new ConformanceAssertionError(`${message} (threw, but wrong error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)})`);
    }
    return;
  }
  throw new ConformanceAssertionError(`${message} (did not throw)`);
}
export {
  verifyMountArtifact,
  runConformanceCase,
  runConformance,
  referenceFixture,
  linkAgentSource,
  computeMountArtifactDigest,
  computeEnvironmentManifestDigest,
  attachMountArtifactPublisher,
  assertEnvironmentManifestDigest,
  assertArtifactHygiene,
  ConformanceNotImplemented,
  AGENT_MOUNT_V1_CONFORMANCE_CASES
};
