import { describe, expect, test } from "bun:test";
import { AGENT_MOUNT_VERSION, type MountArtifact, type ResolvedMountContext } from "../src/core.ts";
import { computeMountArtifactDigest } from "../src/compiler.ts";
import { verifyArtifactActivationBinding } from "../src/runtime.ts";

const artifact: MountArtifact = {
  protocolVersion: AGENT_MOUNT_VERSION,
  artifactDigest: "artifact_test", agentId: "agent_test", sourceDigest: "source_test",
  environmentId: "environment_test", adapterDigest: "adapter_test",
  linkedFunctionality: [], instructions: "test", modelProfile: { family: "test", parameters: {} },
  publisher: { keyId: "publisher_test", signature: "signature_test" },
};
artifact.artifactDigest = await computeMountArtifactDigest(artifact);
const context: ResolvedMountContext = {
  protocolVersion: AGENT_MOUNT_VERSION,
  mountId: "mount_test", environmentId: artifact.environmentId, environmentAccountId: "account_test",
  agentId: artifact.agentId, releaseId: "release_test", principalId: "principal_test",
  artifactDigest: artifact.artifactDigest,
  adapterDigest: artifact.adapterDigest, policyVersion: "policy_test", mountEpoch: 1,
  threadId: "thread_test", runId: "run_test", runGeneration: 1, traceId: "trace_test",
};

describe("runtime ABI", () => {
  test("verifies publisher integrity and binds activation to the exact artifact", async () => {
    const verify = async () => true;
    await expect(verifyArtifactActivationBinding(artifact, context, context.mountId, verify)).resolves.toBeUndefined();
    await expect(verifyArtifactActivationBinding(artifact, { ...context, adapterDigest: "changed" }, context.mountId, verify))
      .rejects.toThrow("does not match the compiled artifact");
    await expect(verifyArtifactActivationBinding(artifact, { ...context, artifactDigest: "changed" }, context.mountId, verify))
      .rejects.toThrow("does not match the compiled artifact");
    await expect(verifyArtifactActivationBinding(artifact, context, context.mountId, async () => false))
      .rejects.toThrow("publisher signature is invalid");
  });
});
