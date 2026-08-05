export const AGENT_MOUNT_VERSION = "agent-mount/v1" as const;

export type FunctionalityKind = "read" | "proposal" | "effect";
export type ApprovalMode = "none" | "runtime" | "environment";
export type AuthorizerKind = "environment_native" | "mount_broker";
export type ArgumentBinding = "environment_verified" | "broker_attested";
export type RevocationProfile = "synchronous" | "cached";
export type ConformanceLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type AgentMountErrorCode =
  | "unauthenticated"
  | "mount_not_found"
  | "mount_inactive"
  | "mount_epoch_stale"
  | "run_inactive"
  | "run_generation_stale"
  | "functionality_denied"
  | "resource_denied"
  | "approval_required"
  | "authorization_invalid"
  | "authorization_expired"
  | "authorization_consumed"
  | "argument_binding_mismatch"
  | "idempotency_conflict"
  | "intent_indeterminate"
  | "invalid_argument"
  | "unsupported_binding"
  | "audit_unavailable"
  | "environment_unavailable";

export class AgentMountError extends Error {
  constructor(
    readonly code: AgentMountErrorCode,
    message: string = code,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentMountError";
  }
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
  adapterDigest: string;
  functionality: readonly FunctionalityDefinition[];
  bindings: {
    chat?: { version: "agent-mount.chat/v1" };
    mcp?: { version: "agent-mount.mcp/v1" };
  };
}

export interface EffectAuthorization {
  authorizationId: string;
  authorizerKind: AuthorizerKind;
  argumentBinding: ArgumentBinding;
  bindingDigest: string;
  mountId: string;
  mountEpoch: number;
  functionalityId: string;
  principalId: string;
  expiresAt: string;
  assurance: string;
  /** Required for broker attestations; the adapter must not hold this key. */
  attestation?: { keyId: string; signature: string };
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

export type FunctionalityOutcome =
  | { status: "completed"; output: unknown; replayed?: boolean; auditId: string }
  | { status: "denied"; error: AgentMountErrorCode; auditId: string }
  | { status: "indeterminate"; intentId: string; error: "intent_indeterminate"; auditId: string };

/**
 * The environment-owned policy/effect boundary. Binding helpers call this
 * interface; they never execute native effects themselves.
 */
export interface FunctionalityInvoker {
  invoke(invocation: FunctionalityInvocation): Promise<FunctionalityOutcome>;
}

const forbiddenContextKeys = new Set([
  "mountId", "mount_id", "tenantId", "tenant_id", "principalId", "principal_id",
  "environmentAccountId", "environment_account_id", "agentId", "agent_id",
  "releaseId", "release_id", "adapterDigest", "adapter_digest", "policyVersion",
  "policy_version", "mountEpoch", "mount_epoch", "runGeneration", "run_generation",
  "grant", "credential", "token",
]);

export function assertDomainArguments(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentMountError("invalid_argument", "Functionality arguments must be an object");
  }
  const visited = new WeakSet<object>();
  const inspect = (candidate: unknown, depth: number): void => {
    if (!candidate || typeof candidate !== "object") return;
    if (depth > 32 || visited.has(candidate)) throw new AgentMountError("invalid_argument", "Arguments exceed structural bounds");
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) inspect(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(candidate as Record<string, unknown>)) {
      if (forbiddenContextKeys.has(key)) {
        throw new AgentMountError("invalid_argument", `Authority field is not allowed in functionality arguments: ${key}`);
      }
      inspect(item, depth + 1);
    }
  };
  inspect(value, 0);
}

function assertJsonString(value: string): void {
  if (/[\uD800-\uDFFF]/u.test(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { index += 1; continue; }
        throw new AgentMountError("invalid_argument", "Canonical JSON rejects unpaired surrogates");
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        throw new AgentMountError("invalid_argument", "Canonical JSON rejects unpaired surrogates");
      }
    }
  }
}

/** RFC 8785-compatible canonicalization for JSON-compatible values. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") { assertJsonString(value); return JSON.stringify(value); }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AgentMountError("invalid_argument", "Canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => {
      assertJsonString(key);
      const item = record[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        throw new AgentMountError("invalid_argument", `Non-JSON value at key: ${key}`);
      }
      return `${JSON.stringify(key)}:${canonicalJson(item)}`;
    }).join(",")}}`;
  }
  throw new AgentMountError("invalid_argument", "Value is not JSON-compatible");
}

export async function argumentBindingDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return encodeBase64Url(new Uint8Array(digest));
}

function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    output += alphabet[(combined >>> 18) & 63];
    output += alphabet[(combined >>> 12) & 63];
    if (index + 1 < bytes.length) output += alphabet[(combined >>> 6) & 63];
    if (index + 2 < bytes.length) output += alphabet[combined & 63];
  }
  return output;
}

export function assertFunctionalityDefinition(definition: FunctionalityDefinition): void {
  if (definition.kind === "effect" && !definition.intentResolutionDeadlineMs) {
    throw new AgentMountError("invalid_argument", `Effect functionality ${definition.id} requires intentResolutionDeadlineMs`);
  }
  if (!definition.reversible && definition.minimumConformanceLevel !== "L4") {
    throw new AgentMountError("invalid_argument", `Irreversible functionality ${definition.id} must require L4`);
  }
}

export function assertEffectAuthorizationBinding(input: {
  authorization: EffectAuthorization;
  context: ResolvedMountContext;
  functionality: FunctionalityDefinition;
  bindingDigest: string;
  now?: number;
}): void {
  const { authorization, context, functionality, bindingDigest } = input;
  if (authorization.mountId !== context.mountId
    || authorization.mountEpoch !== context.mountEpoch
    || authorization.functionalityId !== functionality.id
    || authorization.principalId !== context.principalId
    || authorization.bindingDigest !== bindingDigest) {
    throw new AgentMountError("argument_binding_mismatch");
  }
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new AgentMountError("authorization_invalid");
  if ((input.now ?? Date.now()) >= expiresAt) throw new AgentMountError("authorization_expired");
  if (authorization.authorizerKind === "environment_native"
    && authorization.argumentBinding !== "environment_verified") {
    throw new AgentMountError("authorization_invalid");
  }
  if (authorization.authorizerKind === "mount_broker"
    && authorization.argumentBinding !== "broker_attested") {
    throw new AgentMountError("authorization_invalid");
  }
  if (authorization.authorizerKind === "mount_broker"
    && (!authorization.attestation?.keyId || !authorization.attestation.signature)) {
    throw new AgentMountError("authorization_invalid", "Broker authorization requires an independent attestation");
  }
}
