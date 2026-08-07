import type { AgentSource, EnvironmentManifest, FunctionalityDefinition, MountArtifact, ResolvedMountContext } from "./core.js";
import type { StreamCursor } from "./chat.js";
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
