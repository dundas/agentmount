import type {
  AgentSource,
  EnvironmentManifest,
  FunctionalityDefinition,
  MountArtifact,
  ResolvedMountContext,
} from "./core.js";
import type { StreamCursor } from "./chat.js";

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
