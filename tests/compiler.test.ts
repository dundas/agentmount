import { describe, expect, test } from "bun:test";
import {
  AGENT_MOUNT_VERSION,
  AgentMountError,
  type AgentSource,
  type EnvironmentManifest,
} from "../src/core.ts";
import {
  assertArtifactHygiene,
  assertEnvironmentManifestDigest,
  assertMountArtifactDigest,
  attachMountArtifactPublisher,
  computeEnvironmentManifestDigest,
  linkAgentSource,
  verifyMountArtifact,
} from "../src/compiler.ts";

const source: AgentSource = {
  protocolVersion: AGENT_MOUNT_VERSION,
  agentId: "agent_test",
  sourceDigest: "source_test",
  instructions: "Help the user inside the mounted environment.",
  modelProfile: { family: "portable", parameters: { temperature: 0 } },
  requestedFunctionality: ["test.item.get"],
};

async function manifest(): Promise<EnvironmentManifest> {
  const value: EnvironmentManifest = {
    protocolVersion: AGENT_MOUNT_VERSION,
    environmentId: "environment_test",
    adapterVersion: "1.0.0",
    adapterDigest: "",
    revocation: { profile: "synchronous" },
    functionality: [{
      id: "test.item.get", kind: "read", title: "Get item", description: "Get one item",
      inputSchema: { type: "object" }, approvalMode: "none", reversible: true,
      idempotencyRequired: false, minimumConformanceLevel: "L0",
    }],
    bindings: { chat: { version: "agent-mount.chat/v1" }, mcp: { version: "agent-mount.mcp/v1" } },
  };
  value.adapterDigest = await computeEnvironmentManifestDigest(value);
  return value;
}

describe("compiled mount artifacts", () => {
  test("links deterministically and signs the digest string without changing it", async () => {
    const environment = await manifest();
    const first = await linkAgentSource(source, environment);
    const second = await linkAgentSource(source, environment);
    expect(first).toEqual(second);

    const published = await attachMountArtifactPublisher(first, { keyId: "publisher_a", signature: "signature_a" });
    expect(published.artifactDigest).toBe(first.artifactDigest);
    let verifiedDigest = "";
    await verifyMountArtifact(published, async ({ digest }) => { verifiedDigest = digest; return true; });
    expect(verifiedDigest).toBe(first.artifactDigest);
  });

  test("binds adapterDigest to the canonical manifest contents", async () => {
    const environment = await manifest();
    await expect(assertEnvironmentManifestDigest(environment)).resolves.toBeUndefined();
    const widened: EnvironmentManifest = {
      ...environment,
      functionality: [...environment.functionality, {
        id: "test.item.delete", kind: "effect", title: "Delete", description: "Delete one item",
        inputSchema: {}, approvalMode: "environment", reversible: true,
        idempotencyRequired: true, intentResolutionDeadlineMs: 30_000, minimumConformanceLevel: "L3",
      }],
    };
    await expect(assertEnvironmentManifestDigest(widened)).rejects.toThrow("manifest digest mismatch");

    const duplicated: EnvironmentManifest = {
      ...environment,
      functionality: [...environment.functionality, environment.functionality[0]!],
      adapterDigest: "",
    };
    duplicated.adapterDigest = await computeEnvironmentManifestDigest(duplicated);
    await expect(linkAgentSource(source, duplicated)).rejects.toThrow("Duplicate functionality");
  });

  test("rejects unavailable functionality and mutable authority in source or artifact", async () => {
    const environment = await manifest();
    await expect(linkAgentSource({ ...source, requestedFunctionality: ["test.item.delete"] }, environment))
      .rejects.toMatchObject({ code: "functionality_denied" });
    expect(() => assertArtifactHygiene({ ...source, principalId: "forged" } as AgentSource))
      .toThrow(AgentMountError);
    expect(() => assertArtifactHygiene({
      ...source,
      modelProfile: { ...source.modelProfile, parameters: { apiToken: "forbidden" } },
    })).toThrow(AgentMountError);
    for (const parameters of [
      { apiKey: "forbidden" }, { password: "forbidden" },
      { privateKey: "forbidden" }, { authHeader: "forbidden" },
    ]) {
      expect(() => assertArtifactHygiene({
        ...source, modelProfile: { ...source.modelProfile, parameters },
      })).toThrow(AgentMountError);
    }
  });

  test("rejects artifact content changed after digesting", async () => {
    const linked = await linkAgentSource(source, await manifest());
    await expect(assertMountArtifactDigest({ ...linked, instructions: "tampered" }))
      .rejects.toThrow("artifact digest mismatch");
    await expect(assertMountArtifactDigest({ ...linked, undeclaredField: "tampered" } as typeof linked))
      .rejects.toThrow("Unknown compiled field");
    await expect(verifyMountArtifact(linked as never, async () => true))
      .rejects.toThrow("requires a publisher proof");
  });
});
