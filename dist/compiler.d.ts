import { type AgentSource, type EnvironmentManifest, type MountArtifact, type MountArtifactPublisher } from "./core.js";
export type LinkedMountArtifact = Omit<MountArtifact, "publisher">;
export declare function environmentManifestDigestPreimage(manifest: EnvironmentManifest): Omit<EnvironmentManifest, "adapterDigest">;
export declare function computeEnvironmentManifestDigest(manifest: EnvironmentManifest): Promise<string>;
export declare function assertEnvironmentManifestDigest(manifest: EnvironmentManifest): Promise<void>;
export declare function mountArtifactDigestPreimage(artifact: MountArtifact | LinkedMountArtifact): Omit<LinkedMountArtifact, "artifactDigest">;
export declare function computeMountArtifactDigest(artifact: MountArtifact | LinkedMountArtifact): Promise<string>;
/** Rejects mutable authority, runtime references, and credential-shaped fields anywhere in a compiled artifact. */
export declare function assertArtifactHygiene(value: AgentSource | MountArtifact | LinkedMountArtifact): void;
/** Deterministically links source imports to one integrity-checked environment manifest. */
export declare function linkAgentSource(source: AgentSource, manifest: EnvironmentManifest): Promise<LinkedMountArtifact>;
export declare function assertMountArtifactDigest(artifact: MountArtifact | LinkedMountArtifact): Promise<void>;
export declare function assertPublishedMountArtifact(artifact: MountArtifact): void;
/** Attaches a publisher proof produced by an owner-managed signer. AgentMount never receives the private key. */
export declare function attachMountArtifactPublisher(artifact: LinkedMountArtifact, publisher: MountArtifactPublisher): Promise<MountArtifact>;
export declare function verifyMountArtifact(artifact: MountArtifact, verifyDigestSignature: (input: {
    keyId: string;
    digest: string;
    signature: string;
}) => Promise<boolean>): Promise<void>;
