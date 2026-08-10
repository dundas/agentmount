import type {
  AgentSource,
  EffectAuthorization,
  EnvironmentManifest,
  FunctionalityDefinition,
  FunctionalityOutcome,
  MountArtifact,
  ResolvedMountContext,
} from "./core.js";
import { AGENT_MOUNT_VERSION, AgentMountError, argumentBindingDigest } from "./core.js";
import type { StreamCursor } from "./chat.js";
import { computeEnvironmentManifestDigest, computeMountArtifactDigest } from "./compiler.js";

/** Product-neutral fixtures consumed unchanged by every environment harness. */
export interface AgentMountConformanceFixture {
  source: AgentSource;
  manifest: EnvironmentManifest;
  reversibleEffect: FunctionalityDefinition;
  irreversibleEffect: FunctionalityDefinition;
}

export interface AgentMountConformanceAdapter {
  compile(source: AgentSource, manifest: EnvironmentManifest): Promise<MountArtifact>;
  activate(artifact: MountArtifact): Promise<ResolvedMountContext>;
  revokeMount(context: ResolvedMountContext): Promise<void>;
  replaceRun(context: ResolvedMountContext): Promise<ResolvedMountContext>;
  replay(after: StreamCursor): Promise<readonly { cursor: StreamCursor; eventId: string }[]>;
  sweepIntents(now: number): Promise<readonly { intentId: string; outcome: "indeterminate" }[]>;
}

/** The minimal environment surface needed to prove the L4 native-authorizer rule. */
export interface AgentMountV1IrreversibleEffectConformanceAdapter extends Pick<AgentMountConformanceAdapter, "compile" | "activate"> {
  invokeEffect(input: {
    context: ResolvedMountContext;
    functionality: FunctionalityDefinition;
    arguments: Readonly<Record<string, unknown>>;
    effectAuthorization: EffectAuthorization;
  }): Promise<FunctionalityOutcome>;
}

export const AGENT_MOUNT_V1_CONFORMANCE_CASES = [
  "compile.link_narrows",
  "compile.deterministic_artifact_digest",
  "compile.manifest_digest_binds_exports",
  "compile.artifact_hygiene",
  "authority.ungranted_functionality_denied",
  "authority.revoked_mount_denied_before_effect",
  "authority.stale_run_generation_denied",
  "authority.forged_context_denied",
  "authority.broker_adapter_key_separation",
  "authority.argument_tampering_denied",
  "authority.irreversible_requires_l4_native",
  "replay.idempotent_turn",
  "replay.generation_cursor",
  "replay.persist_before_fanout",
  "intent.pending_becomes_indeterminate",
] as const;

export type AgentMountV1ConformanceCase = (typeof AGENT_MOUNT_V1_CONFORMANCE_CASES)[number];

export const AGENT_MOUNT_V1_COMPILE_CONFORMANCE_CASES = [
  "compile.link_narrows",
  "compile.deterministic_artifact_digest",
  "compile.manifest_digest_binds_exports",
  "compile.artifact_hygiene",
] as const satisfies readonly AgentMountV1ConformanceCase[];

export type AgentMountV1CompileConformanceCase = (typeof AGENT_MOUNT_V1_COMPILE_CONFORMANCE_CASES)[number];

export const AGENT_MOUNT_V1_IRREVERSIBLE_EFFECT_CONFORMANCE_CASES = [
  "authority.irreversible_requires_l4_native",
] as const satisfies readonly AgentMountV1ConformanceCase[];

export type AgentMountV1IrreversibleEffectConformanceCase =
  (typeof AGENT_MOUNT_V1_IRREVERSIBLE_EFFECT_CONFORMANCE_CASES)[number];

/** One product-neutral implementation for every required v1 conformance case. */
export type AgentMountConformanceCaseExecutor = () => void | Promise<void>;

/**
 * An environment supplies the behavior under test; this package owns the case
 * inventory, validation, execution order, and machine-readable result.
 *
 * Do not branch on `environmentId` in these executors. Product-specific setup
 * belongs in the environment's adapter, not in the shared conformance suite.
 */
export interface AgentMountV1ConformanceSuite {
  environmentId: string;
  cases: Readonly<Record<AgentMountV1ConformanceCase, AgentMountConformanceCaseExecutor>>;
}

export interface AgentMountConformanceCaseResult {
  id: AgentMountV1ConformanceCase;
  status: "passed" | "failed";
  error?: unknown;
}

export interface AgentMountV1ConformanceResult {
  environmentId: string;
  passed: boolean;
  cases: readonly AgentMountConformanceCaseResult[];
}

/** Raised by {@link assertAgentMountV1Conformance} when one or more cases fail. */
export class AgentMountConformanceError extends Error {
  constructor(readonly result: AgentMountV1ConformanceResult) {
    const failed = result.cases.filter(({ status }) => status === "failed").map(({ id }) => id);
    super(`AgentMount v1 conformance failed for ${result.environmentId}: ${failed.join(", ")}`);
    this.name = "AgentMountConformanceError";
  }
}

/**
 * Creates executable, product-neutral implementations of the v1 compile
 * cases. Environments compose these with their authority, replay, and intent
 * executors in one `AgentMountV1ConformanceSuite`.
 */
export function createAgentMountV1CompileConformanceExecutors(
  fixture: AgentMountConformanceFixture,
  adapter: Pick<AgentMountConformanceAdapter, "compile">,
): Readonly<Record<AgentMountV1CompileConformanceCase, AgentMountConformanceCaseExecutor>> {
  return {
    "compile.link_narrows": async () => {
      const unavailable = { ...fixture.source, requestedFunctionality: [...fixture.source.requestedFunctionality, "conformance.unavailable"] };
      await expectAgentMountError(
        () => adapter.compile(unavailable, fixture.manifest),
        "functionality_denied",
        "An unavailable requested functionality must be denied",
      );
      const artifact = await adapter.compile(fixture.source, fixture.manifest);
      const expected = [...fixture.source.requestedFunctionality].sort();
      if (JSON.stringify(artifact.linkedFunctionality) !== JSON.stringify(expected)) {
        throw new Error("Linked functionality must be exactly the requested, sorted functionality set");
      }
    },
    "compile.deterministic_artifact_digest": async () => {
      const first = await adapter.compile(fixture.source, fixture.manifest);
      const second = await adapter.compile(fixture.source, fixture.manifest);
      if (first.artifactDigest !== second.artifactDigest) throw new Error("Artifact digest must be deterministic");
      if (first.artifactDigest !== await computeMountArtifactDigest(first)) {
        throw new Error("Artifact digest must bind the compiled artifact contents");
      }
    },
    "compile.manifest_digest_binds_exports": async () => {
      const staleManifest: EnvironmentManifest = {
        ...fixture.manifest,
        functionality: [...fixture.manifest.functionality, fixture.irreversibleEffect],
      };
      await expectAgentMountError(
        () => adapter.compile(fixture.source, staleManifest),
        "invalid_argument",
        "A manifest whose exports changed without recomputing adapterDigest must be denied",
      );
    },
    "compile.artifact_hygiene": async () => {
      const authorityBearingSource = { ...fixture.source, grant: "must-not-be-portable" } as AgentSource;
      await expectAgentMountError(
        () => adapter.compile(authorityBearingSource, fixture.manifest),
        "invalid_argument",
        "A portable source containing mutable authority must be denied",
      );
    },
  };
}

/**
 * Creates the L4 native-authorizer executor. The environment's `invokeEffect`
 * must apply `assertEffectAuthorizationBinding` before it dispatches an
 * effect; a broker authorization for an irreversible effect must be denied.
 */
export function createAgentMountV1IrreversibleEffectConformanceExecutors(
  fixture: AgentMountConformanceFixture,
  adapter: AgentMountV1IrreversibleEffectConformanceAdapter,
  domainArguments: Readonly<Record<string, unknown>>,
): Readonly<Record<AgentMountV1IrreversibleEffectConformanceCase, AgentMountConformanceCaseExecutor>> {
  return {
    "authority.irreversible_requires_l4_native": async () => {
      const source = {
        ...fixture.source,
        requestedFunctionality: [...fixture.source.requestedFunctionality, fixture.irreversibleEffect.id].sort(),
      };
      const artifact = await adapter.compile(source, fixture.manifest);
      const context = await adapter.activate(artifact);
      const effectAuthorization: EffectAuthorization = {
        authorizationId: "conformance_broker_attempt",
        authorizerKind: "mount_broker",
        argumentBinding: "broker_attested",
        bindingDigest: await argumentBindingDigest(domainArguments),
        mountId: context.mountId,
        mountEpoch: context.mountEpoch,
        runGeneration: context.runGeneration,
        functionalityId: fixture.irreversibleEffect.id,
        principalId: context.principalId,
        expiresAt: "9999-12-31T23:59:59.000Z",
        assurance: "conformance_broker_attempt",
        attestation: { keyId: "conformance_broker_key", signature: "conformance_signature" },
      };
      const outcome = await adapter.invokeEffect({
        context,
        functionality: fixture.irreversibleEffect,
        arguments: domainArguments,
        effectAuthorization,
      });
      if (outcome.status !== "denied" || outcome.error !== "authorization_invalid") {
        throw new Error("An irreversible effect authorized by a broker must be denied with authorization_invalid");
      }
    },
  };
}

/** Product-neutral fixture for testing the shared compile cases and adapters. */
export async function createAgentMountV1ReferenceFixture(): Promise<AgentMountConformanceFixture> {
  const read: FunctionalityDefinition = {
    id: "reference.item.get", kind: "read", title: "Get item", description: "Read one item.",
    inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 } } },
    approvalMode: "none", reversible: true, idempotencyRequired: false, minimumConformanceLevel: "L0",
  };
  const reversibleEffect: FunctionalityDefinition = {
    id: "reference.item.upsert", kind: "proposal", title: "Upsert item", description: "Create or update one item.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["title", "idempotencyKey"],
      properties: { title: { type: "string", minLength: 1 }, idempotencyKey: { type: "string", minLength: 16, maxLength: 128 } },
    },
    approvalMode: "none", reversible: true, idempotencyRequired: true, minimumConformanceLevel: "L2",
  };
  const irreversibleEffect: FunctionalityDefinition = {
    id: "reference.item.publish", kind: "effect", title: "Publish item", description: "Irreversibly publish one item.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["id", "idempotencyKey"],
      properties: { id: { type: "string", minLength: 1 }, idempotencyKey: { type: "string", minLength: 16, maxLength: 128 } },
    },
    approvalMode: "environment", reversible: false, idempotencyRequired: true, intentResolutionDeadlineMs: 30_000, minimumConformanceLevel: "L4",
  };
  const unsignedManifest: EnvironmentManifest = {
    protocolVersion: AGENT_MOUNT_VERSION,
    environmentId: "environment_reference",
    adapterVersion: "0.1.0-draft.1",
    adapterDigest: "",
    revocation: { profile: "synchronous" },
    functionality: [read, reversibleEffect, irreversibleEffect],
    bindings: { chat: { version: "agent-mount.chat/v1" }, mcp: { version: "agent-mount.mcp/v1" } },
  };
  const manifest = { ...unsignedManifest, adapterDigest: await computeEnvironmentManifestDigest(unsignedManifest) };
  return {
    source: {
      protocolVersion: AGENT_MOUNT_VERSION,
      agentId: "agent_reference",
      sourceDigest: "source_reference",
      instructions: "Reference agent used by the product-neutral conformance fixture.",
      modelProfile: { family: "portable", parameters: { temperature: 0 } },
      requestedFunctionality: [read.id, reversibleEffect.id],
    },
    manifest,
    reversibleEffect,
    irreversibleEffect,
  };
}

/**
 * Runs every required v1 case in a deterministic order, collecting all case
 * failures so an environment can fix them in one test run.
 */
export async function runAgentMountV1Conformance(
  suite: AgentMountV1ConformanceSuite,
): Promise<AgentMountV1ConformanceResult> {
  if (typeof suite.environmentId !== "string" || suite.environmentId.length === 0) {
    throw new TypeError("AgentMount conformance requires a non-empty environmentId");
  }
  const missing = AGENT_MOUNT_V1_CONFORMANCE_CASES.filter((id) => typeof suite.cases?.[id] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`AgentMount conformance suite is missing case executors: ${missing.join(", ")}`);
  }

  const cases: AgentMountConformanceCaseResult[] = [];
  for (const id of AGENT_MOUNT_V1_CONFORMANCE_CASES) {
    try {
      await suite.cases[id]();
      cases.push({ id, status: "passed" });
    } catch (error) {
      cases.push({ id, status: "failed", error });
    }
  }
  return { environmentId: suite.environmentId, passed: cases.every(({ status }) => status === "passed"), cases };
}

/** Runs the suite and throws a single inspectable error if any required case fails. */
export async function assertAgentMountV1Conformance(
  suite: AgentMountV1ConformanceSuite,
): Promise<AgentMountV1ConformanceResult> {
  const result = await runAgentMountV1Conformance(suite);
  if (!result.passed) throw new AgentMountConformanceError(result);
  return result;
}

async function expectAgentMountError(
  operation: () => Promise<unknown>,
  code: AgentMountError["code"],
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof AgentMountError && error.code === code) return;
    throw new Error(`${message}; received ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
  throw new Error(`${message}; operation succeeded`);
}
