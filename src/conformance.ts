import type {
  AgentSource,
  EnvironmentManifest,
  FunctionalityDefinition,
  MountArtifact,
  ResolvedMountContext,
} from "./core.js";
import type { StreamCursor } from "./chat.js";
import {
  AgentMountError,
  AGENT_MOUNT_VERSION,
} from "./core.js";
import {
  assertArtifactHygiene,
  assertEnvironmentManifestDigest,
  attachMountArtifactPublisher,
  computeEnvironmentManifestDigest,
  computeMountArtifactDigest,
  linkAgentSource,
  verifyMountArtifact,
} from "./compiler.js";

/** Product-neutral fixtures consumed unchanged by every environment harness. */
export interface AgentMountConformanceFixture {
  source: AgentSource;
  manifest: EnvironmentManifest;
  reversibleEffect: FunctionalityDefinition;
  irreversibleEffect: FunctionalityDefinition;
}

export interface AgentMountConformanceAdapter {
  compile(source: AgentSource, manifest: EnvironmentManifest): Promise<MountArtifact>;
  activate(artifact: MountArtifact): Promise<ResolvedMountContext>;
  revokeMount(context: ResolvedMountContext): Promise<void>;
  replaceRun(context: ResolvedMountContext): Promise<ResolvedMountContext>;
  replay(after: StreamCursor): Promise<readonly { cursor: StreamCursor; eventId: string }[]>;
  sweepIntents(now: number): Promise<readonly { intentId: string; outcome: "indeterminate" }[]>;
}

export const AGENT_MOUNT_V1_CONFORMANCE_CASES = [
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
  "intent.pending_becomes_indeterminate",
] as const;

export type AgentMountV1ConformanceCase = (typeof AGENT_MOUNT_V1_CONFORMANCE_CASES)[number];

// ─── Conformance runner ───────────────────────────────────────────────────
//
// PRD 0049 G7 / FR6.2: the conformance runner + fixtures are PRODUCT-NEUTRAL
// and live in the agentmount contract repo (this file, shipped via the
// `./conformance` subpath export). Every consumer environment (Circle, the
// throwaway reference stub, Infinitrade) implements `AgentMountConformance
// Adapter` and runs `runConformance(fixture, adapter)`; the harness asserts
// the same 15 v1 cases against each. No consumer branches the harness.
//
// Slice 1.5 (2026-08-09): the runner skeleton + the 4 `compile.*` cases are
// implemented here. The 11 `authority.*` / `replay.*` / `intent.*` cases are
// honestly marked `not_applicable` with reason "runner case not yet
// implemented" — they will be filled in incrementally (authority.* needs a
// real mount store; replay.* needs the chat transport; intent.* needs L4
// intent reconciliation). Consumers that implement an adapter method the
// runner calls get a real result; consumers that don't implement a method
// the runner needs for an unimplemented case see `not_applicable` either way.
// This is intentionally honest: a green report means "the implemented cases
// pass," not "all 15 pass" — `runConformance` reports `pass`/`fail`/
// `notApplicable` counts so a consumer cannot mistake partial coverage for
// full coverage.

/** The outcome of one conformance case. `not_applicable` is non-failing — it
 * means either the runner hasn't implemented the case yet, or the adapter
 * doesn't implement a method the case needs (a slice-2 prerequisite). */
export interface ConformanceCaseResult {
  case: AgentMountV1ConformanceCase;
  status: "pass" | "fail" | "not_applicable";
  reason?: string;
}

/** The full report. A consumer is "v1-conformant for the implemented surface"
 * when `fail === 0`. `notApplicable` must be reviewed: it's either a runner gap
 * (this file) or a consumer adapter gap (slice-2 prerequisite). */
export interface ConformanceReport {
  results: readonly ConformanceCaseResult[];
  pass: number;
  fail: number;
  notApplicable: number;
}

/** Sentinel: an adapter method the consumer hasn't implemented. The runner
 * treats this as `not_applicable` (a slice-2 prerequisite), never a `fail`. */
export class ConformanceNotImplemented extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`adapter method not implemented: ${method}`);
    this.name = "ConformanceNotImplemented";
    this.method = method;
  }
}

/** Run a single named conformance case against (fixture, adapter). Throws on
 * runner-internal error; returns `{status}` for the case outcome. */
export async function runConformanceCase(
  name: AgentMountV1ConformanceCase,
  fixture: AgentMountConformanceFixture,
  adapter: AgentMountConformanceAdapter,
): Promise<ConformanceCaseResult> {
  try {
    switch (name) {
      // ── compile.* (4) — implemented (slice 1.5) ───────────────────────────
      case "compile.link_narrows": {
        // linkAgentSource narrows source.requestedFunctionality to the manifest's
        // exported functionality. A request for an UNEXPORTED id → functionality_denied;
        // the linked artifact's linkedFunctionality is exactly the (deduped, sorted)
        // requested set, all of which the manifest exports.
        const unexported: AgentSource = {
          ...fixture.source,
          requestedFunctionality: [...fixture.source.requestedFunctionality, "not.exported"],
        };
        await expectRejects(
          () => adapter.compile(unexported, fixture.manifest),
          (e) => e instanceof AgentMountError && e.code === "functionality_denied",
          "compile of an unexported functionality must be denied",
        );
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
        // The digest excludes publisher + artifactDigest from its preimage; attaching a
        // publisher must not change it.
        const published = await attachMountArtifactPublisher(a, { keyId: "k", signature: "s" });
        if (published.artifactDigest !== a.artifactDigest) {
          throw new ConformanceAssertionError("attaching a publisher changed artifactDigest");
        }
        return { case: name, status: "pass" };
      }
      case "compile.manifest_digest_binds_exports": {
        // adapterDigest binds the manifest contents: a manifest whose functionality
        // changed but adapterDigest was NOT recomputed → manifest digest mismatch.
        // The runner re-derives the digest from the fixture's manifest, so the fixture
        // itself is well-formed; this case proves the adapter rejects a tampered manifest.
        const tampered: EnvironmentManifest = {
          ...fixture.manifest,
          functionality: [...fixture.manifest.functionality, fixture.reversibleEffect],
        };
        await expectRejects(
          () => adapter.compile(fixture.source, tampered),
          (e) => e instanceof AgentMountError && (e.code === "invalid_argument" || e.code === "mount_inactive"),
          "compile against a manifest with a stale adapterDigest must be denied",
        );
        return { case: name, status: "pass" };
      }
      case "compile.artifact_hygiene": {
        // assertArtifactHygiene rejects mutable authority / credential fields in the
        // source or artifact. The adapter's compile must surface hygiene failures as
        // invalid_argument (linkAgentSource/assertArtifactHygiene throws AgentMountError).
        const dirty: AgentSource = {
          ...fixture.source,
          // @ts-expect-error — injecting a forbidden mutable-authority field
          grant: "should-be-forbidden",
        };
        await expectRejects(
          () => adapter.compile(dirty as AgentSource, fixture.manifest),
          (e) => e instanceof AgentMountError && e.code === "invalid_argument",
          "a source with a forbidden authority field must fail hygiene",
        );
        return { case: name, status: "pass" };
      }

      // ── authority.* / replay.* / intent.* (11) — not yet implemented ─────
      // These need adapter methods Circle's slice-1 shadow doesn't implement
      // (revokeMount → real mount store; replay → chat transport; sweepIntents →
      // L4 intent reconciliation). The runner case definitions will land
      // incrementally with the slice-2 prerequisite work. Marked not_applicable
      // so a consumer cannot mistake the 4 compile passes for full v1 coverage.
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
        // Exhaustiveness guard: if a case is added to the registry but not handled
        // here, tsc's `never` check catches it at compile time; this runtime guard
        // catches a dynamic dispatch.
        const _exhaustive: never = name;
        void _exhaustive;
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
    // An unexpected throw (adapter threw, or a runner bug) is a fail with the message.
    return {
      case: name,
      status: "fail",
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

/** Run all 15 v1 conformance cases. Never throws — returns a report. */
export async function runConformance(
  fixture: AgentMountConformanceFixture,
  adapter: AgentMountConformanceAdapter,
): Promise<ConformanceReport> {
  const results: ConformanceCaseResult[] = [];
  for (const name of AGENT_MOUNT_V1_CONFORMANCE_CASES) {
    results.push(await runConformanceCase(name, fixture, adapter));
  }
  return {
    results,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    notApplicable: results.filter((r) => r.status === "not_applicable").length,
  };
}

// ─── Reference fixture (product-neutral; FR6.2's "minimal reference second
// environment" self-test fixture, NOT a consumer branch) ──────────────────

/** Build the product-neutral reference fixture. The same fixture is consumed
 * by every consumer's adapter run, so the harness is product-neutral. The
 * fixture's manifest carries the reversible + irreversible effects so the
 * authority.* cases have both kinds to test. */
export async function referenceFixture(): Promise<AgentMountConformanceFixture> {
  const reversibleEffect: FunctionalityDefinition = {
    id: "ref.item.upsert", kind: "proposal", title: "Upsert item", description: "Create or update an item.",
    inputSchema: { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string", minLength: 1 } } },
    approvalMode: "none", reversible: true, idempotencyRequired: true, minimumConformanceLevel: "L2",
  };
  const irreversibleEffect: FunctionalityDefinition = {
    id: "ref.item.publish", kind: "effect", title: "Publish item", description: "Irreversibly publish an item.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 } } },
    approvalMode: "environment", reversible: false, idempotencyRequired: true, intentResolutionDeadlineMs: 30_000, minimumConformanceLevel: "L4",
  };
  const read: FunctionalityDefinition = {
    id: "ref.item.get", kind: "read", title: "Get item", description: "Read one item.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 } } },
    approvalMode: "none", reversible: true, idempotencyRequired: false, minimumConformanceLevel: "L0",
  };
  const base: Omit<EnvironmentManifest, "adapterDigest"> = {
    protocolVersion: AGENT_MOUNT_VERSION,
    environmentId: "environment_reference",
    adapterVersion: "0.1.0-draft.1",
    revocation: { profile: "synchronous" },
    functionality: [read, reversibleEffect, irreversibleEffect],
    bindings: { chat: { version: "agent-mount.chat/v1" }, mcp: { version: "agent-mount.mcp/v1" } },
  };
  const adapterDigest = await computeEnvironmentManifestDigest(base as EnvironmentManifest);
  const manifest: EnvironmentManifest = { ...base, adapterDigest };
  const source: AgentSource = {
    protocolVersion: AGENT_MOUNT_VERSION,
    agentId: "agent_reference",
    sourceDigest: "source_reference",
    instructions: "Reference agent for the product-neutral conformance fixture.",
    modelProfile: { family: "portable", parameters: { temperature: 0 } },
    requestedFunctionality: [read.id, reversibleEffect.id],
  };
  return { source, manifest, reversibleEffect, irreversibleEffect };
}

// ─── Internal helpers ────────────────────────────────────────────────────

/** Thrown by runner case bodies to signal a conformance failure (distinct
 * from an unexpected adapter throw, which is also a fail but carries the
 * adapter's error name). */
class ConformanceAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceAssertionError";
  }
}

async function expectRejects(
  fn: () => Promise<unknown>,
  predicate: (error: unknown) => boolean,
  message: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (!predicate(error)) {
      throw new ConformanceAssertionError(
        `${message} (threw, but wrong error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)})`,
      );
    }
    return;
  }
  throw new ConformanceAssertionError(`${message} (did not throw)`);
}

// Re-export the compiler helpers the runner uses, so consumers importing the
// conformance subpath can build adapters without a second import.
export {
  assertArtifactHygiene,
  assertEnvironmentManifestDigest,
  attachMountArtifactPublisher,
  computeEnvironmentManifestDigest,
  computeMountArtifactDigest,
  linkAgentSource,
  verifyMountArtifact,
};