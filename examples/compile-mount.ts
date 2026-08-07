import {
  attachMountArtifactPublisher,
  computeEnvironmentManifestDigest,
  linkAgentSource,
} from "@agentmount/contracts/compiler";
import { AGENT_MOUNT_VERSION, type AgentSource, type EnvironmentManifest } from "@agentmount/contracts";

const source: AgentSource = {
  protocolVersion: AGENT_MOUNT_VERSION,
  agentId: "agent_portable",
  sourceDigest: "source_digest_from_release_pipeline",
  instructions: "Operate only through linked environment functionality.",
  modelProfile: { family: "portable", parameters: {} },
  requestedFunctionality: ["example.record.read"],
};

const manifest: EnvironmentManifest = {
  protocolVersion: AGENT_MOUNT_VERSION,
  environmentId: "environment_example",
  adapterVersion: "1.0.0",
  adapterDigest: "",
  revocation: { profile: "synchronous" },
  functionality: [{
    id: "example.record.read", kind: "read", title: "Read record", description: "Read one bounded record",
    inputSchema: { type: "object" }, approvalMode: "none", reversible: true,
    idempotencyRequired: false, minimumConformanceLevel: "L0",
  }],
  bindings: { mcp: { version: "agent-mount.mcp/v1" } },
};
manifest.adapterDigest = await computeEnvironmentManifestDigest(manifest);

const linked = await linkAgentSource(source, manifest);

// The owning release pipeline signs linked.artifactDigest. AgentMount never
// receives or stores the publisher's private key.
export const artifact = await attachMountArtifactPublisher(linked, {
  keyId: "publisher_key_id",
  signature: "signature_returned_by_owner_managed_signer",
});
