import type { AgentSource, EffectAuthorization, EnvironmentManifest, FunctionalityDefinition, FunctionalityOutcome, MountArtifact, ResolvedMountContext } from "./core.js";
import type { StreamCursor } from "./chat.js";
import { assertEffectAuthorizationBinding } from "./core.js";
import { assertArtifactHygiene, assertEnvironmentManifestDigest, attachMountArtifactPublisher, computeEnvironmentManifestDigest, computeMountArtifactDigest, linkAgentSource, verifyMountArtifact } from "./compiler.js";
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
    /** Invoke an effect with a pre-built `EffectAuthorization`. The adapter MUST call
     * the contract's `assertEffectAuthorizationBinding` (the L4-native-authorizer,
     * binding-digest, expiry, epoch/generation enforcement) before the dispatch; a
     * binding failure → `{status: "denied", error: "authorization_invalid" | ...}`.
     * This is the method the `authority.*` effect cases exercise (slice 2+).
     * Adapters that don't implement effect invocation throw `ConformanceNotImplemented`
     * → the case reports `not_applicable` (slice 1.5 partial-adapter posture). */
    invokeEffect(input: {
        context: ResolvedMountContext;
        functionality: FunctionalityDefinition;
        arguments: Record<string, unknown>;
        effectAuthorization: EffectAuthorization;
    }): Promise<FunctionalityOutcome>;
    revokeMount(context: ResolvedMountContext): Promise<void>;
    replaceRun(context: ResolvedMountContext): Promise<ResolvedMountContext>;
    replay(after: StreamCursor): Promise<readonly {
        cursor: StreamCursor;
        eventId: string;
    }[]>;
    sweepIntents(now: number): Promise<readonly {
        intentId: string;
        outcome: "indeterminate";
    }[]>;
}
export declare const AGENT_MOUNT_V1_CONFORMANCE_CASES: readonly ["compile.link_narrows", "compile.deterministic_artifact_digest", "compile.manifest_digest_binds_exports", "compile.artifact_hygiene", "authority.ungranted_functionality_denied", "authority.revoked_mount_denied_before_effect", "authority.stale_run_generation_denied", "authority.forged_context_denied", "authority.broker_adapter_key_separation", "authority.argument_tampering_denied", "authority.irreversible_requires_l4_native", "replay.idempotent_turn", "replay.generation_cursor", "replay.persist_before_fanout", "intent.pending_becomes_indeterminate"];
export type AgentMountV1ConformanceCase = (typeof AGENT_MOUNT_V1_CONFORMANCE_CASES)[number];
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
export declare class ConformanceNotImplemented extends Error {
    readonly method: string;
    constructor(method: string);
}
/** Run a single named conformance case against (fixture, adapter). Throws on
 * runner-internal error; returns `{status}` for the case outcome. */
export declare function runConformanceCase(name: AgentMountV1ConformanceCase, fixture: AgentMountConformanceFixture, adapter: AgentMountConformanceAdapter): Promise<ConformanceCaseResult>;
/** Run all 15 v1 conformance cases. Never throws — returns a report. */
export declare function runConformance(fixture: AgentMountConformanceFixture, adapter: AgentMountConformanceAdapter): Promise<ConformanceReport>;
/** Build the product-neutral reference fixture. The same fixture is consumed
 * by every consumer's adapter run, so the harness is product-neutral. The
 * fixture's manifest carries the reversible + irreversible effects so the
 * authority.* cases have both kinds to test. */
export declare function referenceFixture(): Promise<AgentMountConformanceFixture>;
export { assertArtifactHygiene, assertEffectAuthorizationBinding, assertEnvironmentManifestDigest, attachMountArtifactPublisher, computeEnvironmentManifestDigest, computeMountArtifactDigest, linkAgentSource, verifyMountArtifact, };
