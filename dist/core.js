// src/core.ts
var AGENT_MOUNT_VERSION = "agent-mount/v1";

class AgentMountError extends Error {
  code;
  retryable;
  constructor(code, message = code, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "AgentMountError";
  }
}
var forbiddenContextKeys = new Set([
  "mount_id",
  "tenant_id",
  "principal_id",
  "environment_account_id",
  "agent_id",
  "release_id",
  "artifact_digest",
  "adapter_digest",
  "policy_version",
  "mount_epoch",
  "run_generation",
  "runtime_session_generation",
  "client_turn_id",
  "grant",
  "credential",
  "token"
]);
function normalizedArgumentKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/gu, "_").toLowerCase();
}
function assertDomainArguments(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentMountError("invalid_argument", "Functionality arguments must be an object");
  }
  const visited = new WeakSet;
  const inspect = (candidate, depth) => {
    if (!candidate || typeof candidate !== "object")
      return;
    if (depth > 32 || visited.has(candidate))
      throw new AgentMountError("invalid_argument", "Arguments exceed structural bounds");
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate)
        inspect(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(candidate)) {
      if (forbiddenContextKeys.has(normalizedArgumentKey(key))) {
        throw new AgentMountError("invalid_argument", `Authority field is not allowed in functionality arguments: ${key}`);
      }
      inspect(item, depth + 1);
    }
  };
  inspect(value, 0);
}
function assertJsonString(value) {
  if (/[\uD800-\uDFFF]/u.test(value)) {
    for (let index = 0;index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 55296 && code <= 56319) {
        const next = value.charCodeAt(index + 1);
        if (next >= 56320 && next <= 57343) {
          index += 1;
          continue;
        }
        throw new AgentMountError("invalid_argument", "Canonical JSON rejects unpaired surrogates");
      }
      if (code >= 56320 && code <= 57343) {
        throw new AgentMountError("invalid_argument", "Canonical JSON rejects unpaired surrogates");
      }
    }
  }
}
function canonicalJson(value) {
  if (value === null)
    return "null";
  if (typeof value === "string") {
    assertJsonString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean")
    return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new AgentMountError("invalid_argument", "Canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value;
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
async function argumentBindingDigest(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return encodeBase64Url(new Uint8Array(digest));
}
function encodeBase64Url(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0;index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = first << 16 | second << 8 | third;
    output += alphabet[combined >>> 18 & 63];
    output += alphabet[combined >>> 12 & 63];
    if (index + 1 < bytes.length)
      output += alphabet[combined >>> 6 & 63];
    if (index + 2 < bytes.length)
      output += alphabet[combined & 63];
  }
  return output;
}
function assertFunctionalityDefinition(definition) {
  if (definition.kind === "effect" && (!Number.isSafeInteger(definition.intentResolutionDeadlineMs) || definition.intentResolutionDeadlineMs <= 0)) {
    throw new AgentMountError("invalid_argument", `Effect functionality ${definition.id} requires intentResolutionDeadlineMs`);
  }
  if (definition.kind === "effect" && !definition.idempotencyRequired) {
    throw new AgentMountError("invalid_argument", `Effect functionality ${definition.id} requires idempotency`);
  }
  if (!definition.reversible && definition.minimumConformanceLevel !== "L4") {
    throw new AgentMountError("invalid_argument", `Irreversible functionality ${definition.id} must require L4`);
  }
}
function assertEffectAuthorizationBinding(input) {
  const { authorization, context, functionality, bindingDigest } = input;
  if (authorization.mountId !== context.mountId || authorization.functionalityId !== functionality.id || authorization.principalId !== context.principalId || authorization.bindingDigest !== bindingDigest) {
    throw new AgentMountError("argument_binding_mismatch");
  }
  if (authorization.mountEpoch !== context.mountEpoch)
    throw new AgentMountError("mount_epoch_stale");
  if (authorization.runGeneration !== context.runGeneration)
    throw new AgentMountError("run_generation_stale");
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(expiresAt))
    throw new AgentMountError("authorization_invalid");
  if ((input.now ?? Date.now()) >= expiresAt)
    throw new AgentMountError("authorization_expired");
  if (authorization.authorizerKind === "environment_native" && authorization.argumentBinding !== "environment_verified") {
    throw new AgentMountError("authorization_invalid");
  }
  if (authorization.authorizerKind === "mount_broker" && authorization.argumentBinding !== "broker_attested") {
    throw new AgentMountError("authorization_invalid");
  }
  if (authorization.authorizerKind === "mount_broker" && (!authorization.attestation?.keyId || !authorization.attestation.signature)) {
    throw new AgentMountError("authorization_invalid", "Broker authorization requires an independent attestation");
  }
  if (authorization.authorizerKind === "mount_broker" && !Array.isArray(input.adapterSigningKeyIds)) {
    throw new AgentMountError("authorization_invalid", "Broker authorization requires an explicit adapter key inventory");
  }
  if (authorization.authorizerKind === "mount_broker" && input.adapterSigningKeyIds.includes(authorization.attestation.keyId)) {
    throw new AgentMountError("authorization_invalid", "Broker attestation key is held by the adapter");
  }
  if (!functionality.reversible && authorization.authorizerKind !== "environment_native") {
    throw new AgentMountError("authorization_invalid", "Irreversible functionality requires an environment-native authorizer");
  }
}
export {
  canonicalJson,
  assertFunctionalityDefinition,
  assertEffectAuthorizationBinding,
  assertDomainArguments,
  argumentBindingDigest,
  AgentMountError,
  AGENT_MOUNT_VERSION
};
