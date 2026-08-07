// src/runtime.ts
import {
  AgentMountError
} from "./core.js";
import { verifyMountArtifact } from "./compiler.js";
async function verifyArtifactActivationBinding(artifact, context, requestedMountId, verifyDigestSignature) {
  await verifyMountArtifact(artifact, verifyDigestSignature);
  if (context.mountId !== requestedMountId)
    throw new AgentMountError("mount_not_found");
  if (context.agentId !== artifact.agentId || context.environmentId !== artifact.environmentId || context.artifactDigest !== artifact.artifactDigest || context.adapterDigest !== artifact.adapterDigest) {
    throw new AgentMountError("mount_inactive", "Activation context does not match the compiled artifact");
  }
}
export {
  verifyArtifactActivationBinding
};
