export declare const AGENT_MOUNT_VERSION: "agent-mount/v1";
export type FunctionalityKind = "read" | "proposal" | "effect";
export type ApprovalMode = "none" | "runtime" | "environment";
export type AuthorizerKind = "environment_native" | "mount_broker";
export type ArgumentBinding = "environment_verified" | "broker_attested";
/** v1 requires authoritative revocation checks at effect time. Cached profiles are deferred. */
export type RevocationProfile = "synchronous";
export type ConformanceLevel = "L0" | "L1" | "L2" | "L3" | "L4";
export type AgentMountErrorCode = "unauthenticated" | "mount_not_found" | "mount_inactive" | "mount_epoch_stale" | "run_inactive" | "run_generation_stale" | "functionality_denied" | "resource_denied" | "approval_required" | "authorization_invalid" | "authorization_expired" | "authorization_consumed" | "argument_binding_mismatch" | "idempotency_conflict" | "intent_indeterminate" | "invalid_argument" | "unsupported_binding" | "audit_unavailable" | "environment_unavailable";
export declare class AgentMountError extends Error {
    readonly code: AgentMountErrorCode;
    readonly retryable: boolean;
    constructor(code: AgentMountErrorCode, message?: string, retryable?: boolean);
}
export interface MountReference {
    mountId: string;
    threadId?: string;
    runId?: string;
}
/** Trusted context resolved by the environment; never deserialize this from tool arguments. */
export interface ResolvedMountContext {
    protocolVersion: typeof AGENT_MOUNT_VERSION;
    mountId: string;
    environmentId: string;
    environmentAccountId: string;
    agentId: string;
    releaseId: string;
    /** Exact compiled artifact installed for this mount. */
    artifactDigest: string;
    principalId: string;
    adapterDigest: string;
    policyVersion: string;
    mountEpoch: number;
    threadId: string;
    runId: string;
    runGeneration: number;
    traceId: string;
}
export interface FunctionalityDefinition {
    id: string;
    kind: FunctionalityKind;
    title: string;
    description: string;
    inputSchema: unknown;
    outputSchema?: unknown;
    approvalMode: ApprovalMode;
    reversible: boolean;
    idempotencyRequired: boolean;
    intentResolutionDeadlineMs?: number;
    minimumConformanceLevel: ConformanceLevel;
}
export interface EnvironmentManifest {
    protocolVersion: typeof AGENT_MOUNT_VERSION;
    environmentId: string;
    adapterVersion: string;
    /** Digest of the canonical manifest with this field omitted. */
    adapterDigest: string;
    revocation: {
        profile: RevocationProfile;
    };
    functionality: readonly FunctionalityDefinition[];
    bindings: {
        chat?: {
            version: "agent-mount.chat/v1";
        };
        mcp?: {
            version: "agent-mount.mcp/v1";
        };
    };
}
export interface EffectAuthorization {
    authorizationId: string;
    authorizerKind: AuthorizerKind;
    argumentBinding: ArgumentBinding;
    bindingDigest: string;
    mountId: string;
    mountEpoch: number;
    runGeneration: number;
    functionalityId: string;
    principalId: string;
    expiresAt: string;
    assurance: string;
    /** Required for broker attestations; the adapter must not hold this key. */
    attestation?: {
        keyId: string;
        signature: string;
    };
}
/** Compile-time source. Mutable authority and runtime references are forbidden here. */
export interface AgentSource {
    protocolVersion: typeof AGENT_MOUNT_VERSION;
    agentId: string;
    sourceDigest: string;
    instructions: string;
    modelProfile: {
        family: string;
        parameters: Readonly<Record<string, unknown>>;
    };
    requestedFunctionality: readonly string[];
}
export interface MountArtifactPublisher {
    keyId: string;
    /** Signature over the artifactDigest string. */
    signature: string;
}
/**
 * Portable compiled output. artifactDigest excludes artifactDigest and
 * publisher from its preimage; publisher.signature signs artifactDigest.
 */
export interface MountArtifact {
    protocolVersion: typeof AGENT_MOUNT_VERSION;
    artifactDigest: string;
    agentId: string;
    sourceDigest: string;
    environmentId: string;
    adapterDigest: string;
    linkedFunctionality: readonly string[];
    instructions: string;
    modelProfile: AgentSource["modelProfile"];
    publisher: MountArtifactPublisher;
}
export interface FunctionalityInvocation {
    context: ResolvedMountContext;
    functionality: FunctionalityDefinition;
    arguments: Readonly<Record<string, unknown>>;
    idempotencyKey?: string;
    bindingDigest: string;
    transport: "chat" | "mcp" | "http" | "admp" | "local";
    effectAuthorization?: EffectAuthorization;
}
export type FunctionalityOutcome = {
    status: "completed";
    output: unknown;
    replayed?: boolean;
    auditId: string;
} | {
    status: "denied";
    error: AgentMountErrorCode;
    auditId: string;
} | {
    status: "indeterminate";
    intentId: string;
    error: "intent_indeterminate";
    auditId: string;
};
/**
 * The environment-owned policy/effect boundary. Binding helpers call this
 * interface; they never execute native effects themselves.
 */
export interface FunctionalityInvoker {
    invoke(invocation: FunctionalityInvocation): Promise<FunctionalityOutcome>;
}
export declare function assertDomainArguments(value: unknown): asserts value is Record<string, unknown>;
/** RFC 8785-compatible canonicalization for JSON-compatible values. */
export declare function canonicalJson(value: unknown): string;
export declare function argumentBindingDigest(value: unknown): Promise<string>;
export declare function assertFunctionalityDefinition(definition: FunctionalityDefinition): void;
export declare function assertEffectAuthorizationBinding(input: {
    authorization: EffectAuthorization;
    context: ResolvedMountContext;
    functionality: FunctionalityDefinition;
    bindingDigest: string;
    /** Explicit adapter key inventory. Required even when intentionally empty. */
    adapterSigningKeyIds: readonly string[];
    now?: number;
}): void;
