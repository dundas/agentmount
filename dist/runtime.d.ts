import { type FunctionalityInvocation, type FunctionalityOutcome, type MountArtifact, type ResolvedMountContext } from "./core.js";
export interface MountActivationInput {
    artifact: MountArtifact;
    mountId: string;
    threadId?: string;
    runId?: string;
}
export interface IndeterminateIntent {
    intentId: string;
    mountId: string;
    functionalityId: string;
    outcome: "indeterminate";
    resolvedAt: string;
}
/**
 * Host-implemented runtime ABI. The scheduler is host-owned; the deadline
 * transition and returned evidence are normative.
 */
export interface MountRuntime {
    activate(input: MountActivationInput): Promise<ResolvedMountContext>;
    invoke(invocation: FunctionalityInvocation): Promise<FunctionalityOutcome>;
    sweepIntents(now: number): Promise<readonly IndeterminateIntent[]>;
}
/** Verifies publisher integrity and binds mutable activation state to the exact artifact. */
export declare function verifyArtifactActivationBinding(artifact: MountArtifact, context: ResolvedMountContext, requestedMountId: string, verifyDigestSignature: (input: {
    keyId: string;
    digest: string;
    signature: string;
}) => Promise<boolean>): Promise<void>;
