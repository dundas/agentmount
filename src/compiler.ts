import {
  AGENT_MOUNT_VERSION,
  AgentMountError,
  argumentBindingDigest,
  assertFunctionalityDefinition,
  type AgentSource,
  type EnvironmentManifest,
  type MountArtifact,
  type MountArtifactPublisher,
} from "./core.js";

export type LinkedMountArtifact = Omit<MountArtifact, "publisher">;

export function environmentManifestDigestPreimage(
  manifest: EnvironmentManifest,
): Omit<EnvironmentManifest, "adapterDigest"> {
  const preimage = { ...manifest } as Record<string, unknown>;
  delete preimage.adapterDigest;
  return preimage as Omit<EnvironmentManifest, "adapterDigest">;
}

export async function computeEnvironmentManifestDigest(manifest: EnvironmentManifest): Promise<string> {
  return argumentBindingDigest(environmentManifestDigestPreimage(manifest));
}

export async function assertEnvironmentManifestDigest(manifest: EnvironmentManifest): Promise<void> {
  if (manifest.protocolVersion !== AGENT_MOUNT_VERSION) throw new AgentMountError("invalid_argument", "Unsupported manifest version");
  if (manifest.revocation?.profile !== "synchronous") throw new AgentMountError("invalid_argument", "v1 requires synchronous revocation");
  const expected = await computeEnvironmentManifestDigest(manifest);
  if (manifest.adapterDigest !== expected) throw new AgentMountError("invalid_argument", "Environment manifest digest mismatch");
  const functionalityIds = new Set<string>();
  for (const definition of manifest.functionality) {
    assertFunctionalityDefinition(definition);
    if (functionalityIds.has(definition.id)) {
      throw new AgentMountError("invalid_argument", `Duplicate functionality: ${definition.id}`);
    }
    functionalityIds.add(definition.id);
  }
}

export function mountArtifactDigestPreimage(
  artifact: MountArtifact | LinkedMountArtifact,
): Omit<LinkedMountArtifact, "artifactDigest"> {
  const preimage = { ...artifact } as Record<string, unknown>;
  delete preimage.artifactDigest;
  delete preimage.publisher;
  return preimage as Omit<LinkedMountArtifact, "artifactDigest">;
}

export async function computeMountArtifactDigest(artifact: MountArtifact | LinkedMountArtifact): Promise<string> {
  return argumentBindingDigest(mountArtifactDigestPreimage(artifact));
}

const forbiddenArtifactKeys = new Set([
  "mount_id", "mount_epoch", "run_generation", "principal_id",
  "environment_account_id", "authorization_id", "expires_at", "grant",
  "api_key", "password", "passwd", "private_key", "auth_header",
  "access_key", "access_key_id", "authorization", "bearer", "oauth", "cookie", "set_cookie",
]);
const forbiddenArtifactKeyParts = new Set(["secret", "token", "credential", "session", "consent"]);
const sourceKeys = new Set([
  "protocolVersion", "agentId", "sourceDigest", "instructions", "modelProfile", "requestedFunctionality",
]);
const artifactKeys = new Set([
  "protocolVersion", "artifactDigest", "agentId", "sourceDigest", "environmentId", "adapterDigest",
  "linkedFunctionality", "instructions", "modelProfile", "publisher",
]);
const modelProfileKeys = new Set(["family", "parameters"]);
const publisherKeys = new Set(["keyId", "signature"]);

function normalizedKeyParts(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}

function objectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentMountError("invalid_argument", `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new AgentMountError("invalid_argument", `Unknown compiled field: ${path}.${key}`);
  }
}

function assertStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new AgentMountError("invalid_argument", `${path} must contain non-empty strings`);
  }
}

/** Rejects mutable authority, runtime references, and credential-shaped fields anywhere in a compiled artifact. */
export function assertArtifactHygiene(value: AgentSource | MountArtifact | LinkedMountArtifact): void {
  const root = objectRecord(value, "artifact");
  const source = "requestedFunctionality" in root;
  assertExactKeys(root, source ? sourceKeys : artifactKeys, source ? "source" : "artifact");
  for (const key of source
    ? ["protocolVersion", "agentId", "sourceDigest", "instructions"]
    : ["protocolVersion", "artifactDigest", "agentId", "sourceDigest", "environmentId", "adapterDigest", "instructions"]) {
    if (typeof root[key] !== "string" || !root[key]) throw new AgentMountError("invalid_argument", `${key} must be a non-empty string`);
  }
  assertStringArray(root[source ? "requestedFunctionality" : "linkedFunctionality"], source ? "requestedFunctionality" : "linkedFunctionality");
  const modelProfile = objectRecord(root.modelProfile, "modelProfile");
  assertExactKeys(modelProfile, modelProfileKeys, "modelProfile");
  if (typeof modelProfile.family !== "string" || !modelProfile.family) throw new AgentMountError("invalid_argument", "modelProfile.family is required");
  objectRecord(modelProfile.parameters, "modelProfile.parameters");
  if (!source && root.publisher !== undefined) {
    const publisher = objectRecord(root.publisher, "publisher");
    assertExactKeys(publisher, publisherKeys, "publisher");
    if (typeof publisher.keyId !== "string" || !publisher.keyId
      || typeof publisher.signature !== "string" || !publisher.signature) {
      throw new AgentMountError("invalid_argument", "Publisher proof is incomplete");
    }
  }

  const visited = new WeakSet<object>();
  const inspect = (candidate: unknown, depth: number): void => {
    if (!candidate || typeof candidate !== "object") return;
    if (depth > 32 || visited.has(candidate)) throw new AgentMountError("invalid_argument", "Artifact exceeds structural bounds");
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) inspect(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(candidate as Record<string, unknown>)) {
      const normalized = normalizedKeyParts(key).join("_");
      const parts = normalizedKeyParts(key);
      if (forbiddenArtifactKeys.has(normalized) || parts.some((part) => forbiddenArtifactKeyParts.has(part))) {
        throw new AgentMountError("invalid_argument", `Mutable authority or credential field is forbidden in an artifact: ${key}`);
      }
      inspect(item, depth + 1);
    }
  };
  inspect(value, 0);
}

/** Deterministically links source imports to one integrity-checked environment manifest. */
export async function linkAgentSource(source: AgentSource, manifest: EnvironmentManifest): Promise<LinkedMountArtifact> {
  assertArtifactHygiene(source);
  if (source.protocolVersion !== AGENT_MOUNT_VERSION) throw new AgentMountError("invalid_argument", "Unsupported agent source version");
  await assertEnvironmentManifestDigest(manifest);

  const requested = [...new Set(source.requestedFunctionality)].sort();
  if (requested.length !== source.requestedFunctionality.length) {
    throw new AgentMountError("invalid_argument", "Requested functionality contains duplicates");
  }
  const exported = new Set(manifest.functionality.map(({ id }) => id));
  for (const id of requested) {
    if (!exported.has(id)) throw new AgentMountError("functionality_denied", `Environment does not export requested functionality: ${id}`);
  }

  const preimage: Omit<LinkedMountArtifact, "artifactDigest"> = {
    protocolVersion: AGENT_MOUNT_VERSION,
    agentId: source.agentId,
    sourceDigest: source.sourceDigest,
    environmentId: manifest.environmentId,
    adapterDigest: manifest.adapterDigest,
    linkedFunctionality: requested,
    instructions: source.instructions,
    modelProfile: source.modelProfile,
  };
  const linked: LinkedMountArtifact = {
    ...preimage,
    artifactDigest: await argumentBindingDigest(preimage),
  };
  assertArtifactHygiene(linked);
  return linked;
}

export async function assertMountArtifactDigest(artifact: MountArtifact | LinkedMountArtifact): Promise<void> {
  assertArtifactHygiene(artifact);
  if (artifact.protocolVersion !== AGENT_MOUNT_VERSION) throw new AgentMountError("invalid_argument", "Unsupported artifact version");
  if (artifact.artifactDigest !== await computeMountArtifactDigest(artifact)) {
    throw new AgentMountError("invalid_argument", "Mount artifact digest mismatch");
  }
}

export function assertPublishedMountArtifact(artifact: MountArtifact): void {
  assertArtifactHygiene(artifact);
  const publisher = (artifact as Partial<MountArtifact>).publisher;
  if (!publisher || typeof publisher.keyId !== "string" || !publisher.keyId
    || typeof publisher.signature !== "string" || !publisher.signature) {
    throw new AgentMountError("invalid_argument", "Published mount artifact requires a publisher proof");
  }
}

/** Attaches a publisher proof produced by an owner-managed signer. AgentMount never receives the private key. */
export async function attachMountArtifactPublisher(
  artifact: LinkedMountArtifact,
  publisher: MountArtifactPublisher,
): Promise<MountArtifact> {
  await assertMountArtifactDigest(artifact);
  if (!publisher.keyId || !publisher.signature) throw new AgentMountError("invalid_argument", "Publisher proof is incomplete");
  const published: MountArtifact = {
    ...artifact,
    publisher: { keyId: publisher.keyId, signature: publisher.signature },
  };
  assertArtifactHygiene(published);
  return published;
}

export async function verifyMountArtifact(
  artifact: MountArtifact,
  verifyDigestSignature: (input: { keyId: string; digest: string; signature: string }) => Promise<boolean>,
): Promise<void> {
  assertPublishedMountArtifact(artifact);
  await assertMountArtifactDigest(artifact);
  const valid = await verifyDigestSignature({
    keyId: artifact.publisher.keyId,
    digest: artifact.artifactDigest,
    signature: artifact.publisher.signature,
  });
  if (!valid) throw new AgentMountError("authorization_invalid", "Mount artifact publisher signature is invalid");
}
