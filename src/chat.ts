import {
  AgentMountError,
  argumentBindingDigest,
  type AgentMountErrorCode,
  type FunctionalityOutcome,
  type MountReference,
  type ResolvedMountContext,
} from "./core.js";

export const AGENT_MOUNT_CHAT_VERSION = "agent-mount.chat/v1" as const;

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "attachment_ref"; attachmentId: string; mediaType?: string };

export type ChatClientCommand =
  | {
      version: typeof AGENT_MOUNT_CHAT_VERSION;
      type: "turn.submit";
      mountId: string;
      threadId?: string;
      clientTurnId: string;
      idempotencyKey: string;
      content: readonly ChatContentPart[];
    }
  | {
      version: typeof AGENT_MOUNT_CHAT_VERSION;
      type: "events.replay";
      mountId: string;
      threadId: string;
      afterSequence: number;
      limit?: number;
    }
  | {
      version: typeof AGENT_MOUNT_CHAT_VERSION;
      type: "run.cancel";
      mountId: string;
      threadId: string;
      runId: string;
    }
  | {
      version: typeof AGENT_MOUNT_CHAT_VERSION;
      type: "approval.decide";
      mountId: string;
      threadId: string;
      runId: string;
      challengeId: string;
      decision: "approve" | "deny";
    };

export type ChatEventBody =
  | { type: "run.accepted"; clientTurnId: string; replayed: boolean }
  | { type: "run.status"; phase: "queued" | "working" | "awaiting_approval" | "executing" }
  | { type: "message.delta"; messageId: string; delta: string }
  | { type: "message.completed"; messageId: string; content: string }
  | { type: "functionality.started"; invocationId: string; functionalityId: string }
  | { type: "functionality.completed"; invocationId: string; functionalityId: string; outcome: FunctionalityOutcome }
  | { type: "functionality.failed"; invocationId: string; functionalityId: string; error: AgentMountErrorCode }
  | { type: "approval.requested"; challengeId: string; functionalityId: string; bindingDigest: string; expiresAt: string; prompt: string }
  | { type: "approval.resolved"; challengeId: string; decision: "approve" | "deny" }
  | { type: "artifact.available"; artifactId: string; mediaType: string; title?: string }
  | { type: "run.completed" }
  | { type: "run.failed"; error: AgentMountErrorCode; retryable: boolean };

export interface ChatServerEvent {
  version: typeof AGENT_MOUNT_CHAT_VERSION;
  eventId: string;
  sequence: number;
  mountId: string;
  threadId: string;
  runId: string;
  runGeneration: number;
  traceId: string;
  occurredAt: string;
  body: ChatEventBody;
}

export interface AcceptedTurn {
  context: ResolvedMountContext;
  clientTurnId: string;
  content: readonly ChatContentPart[];
  bindingDigest: string;
  replayed: boolean;
}

export interface ChatTurnReceipt {
  turn: AcceptedTurn;
  /** Present for a newly accepted turn; retries return the original run in `turn`. */
  acceptedEvent?: ChatServerEvent;
}

export interface ChatBindingStore {
  /** Atomically returns the original accepted run for an equivalent retry. */
  acceptTurn(input: {
    context: ResolvedMountContext;
    clientTurnId: string;
    idempotencyKey: string;
    content: readonly ChatContentPart[];
    bindingDigest: string;
  }): Promise<AcceptedTurn>;
  appendEvent(context: ResolvedMountContext, body: ChatEventBody): Promise<ChatServerEvent>;
  replay(reference: MountReference & { threadId: string }, afterSequence: number, limit: number): Promise<readonly ChatServerEvent[]>;
}

export interface ChatRuntime {
  dispatch(turn: AcceptedTurn): AsyncIterable<ChatEventBody>;
  cancel(context: ResolvedMountContext): Promise<void>;
}

export interface ChatApprovalResolver {
  decide(input: {
    context: ResolvedMountContext;
    challengeId: string;
    decision: "approve" | "deny";
  }): Promise<void>;
}

export interface ChatBindingDependencies {
  resolveContext(reference: MountReference): Promise<ResolvedMountContext>;
  store: ChatBindingStore;
  runtime: ChatRuntime;
  approvals: ChatApprovalResolver;
  maxTextChars?: number;
  maxReplayEvents?: number;
}

export function createChatBinding(dependencies: ChatBindingDependencies) {
  const maxTextChars = dependencies.maxTextChars ?? 32_000;
  const maxReplayEvents = dependencies.maxReplayEvents ?? 200;

  return {
    async submit(command: Extract<ChatClientCommand, { type: "turn.submit" }>): Promise<ChatTurnReceipt> {
      assertVersion(command.version);
      assertContent(command.content, maxTextChars);
      const context = await dependencies.resolveContext({ mountId: command.mountId, ...(command.threadId ? { threadId: command.threadId } : {}) });
      const bindingDigest = await argumentBindingDigest(command.content);
      const accepted = await dependencies.store.acceptTurn({
        context,
        clientTurnId: command.clientTurnId,
        idempotencyKey: command.idempotencyKey,
        content: command.content,
        bindingDigest,
      });
      let acceptedEvent: ChatServerEvent | undefined;
      if (!accepted.replayed) {
        acceptedEvent = await dependencies.store.appendEvent(accepted.context, {
          type: "run.accepted", clientTurnId: accepted.clientTurnId, replayed: false,
        });
      }
      return { turn: accepted, ...(acceptedEvent ? { acceptedEvent } : {}) };
    },

    async *dispatch(turn: AcceptedTurn): AsyncIterable<ChatServerEvent> {
      if (turn.replayed) return;
      for await (const body of dependencies.runtime.dispatch(turn)) {
        // Persistence completes before the event becomes visible to a transport.
        yield await dependencies.store.appendEvent(turn.context, body);
      }
    },

    async replay(command: Extract<ChatClientCommand, { type: "events.replay" }>): Promise<readonly ChatServerEvent[]> {
      assertVersion(command.version);
      const limit = Math.min(command.limit ?? maxReplayEvents, maxReplayEvents);
      if (!Number.isInteger(command.afterSequence) || command.afterSequence < 0 || limit < 1) {
        throw new AgentMountError("invalid_argument");
      }
      await dependencies.resolveContext({ mountId: command.mountId, threadId: command.threadId });
      const events = await dependencies.store.replay(
        { mountId: command.mountId, threadId: command.threadId }, command.afterSequence, limit,
      );
      assertOrderedEvents(events, command.mountId, command.threadId, command.afterSequence);
      return events;
    },

    async cancel(command: Extract<ChatClientCommand, { type: "run.cancel" }>): Promise<void> {
      assertVersion(command.version);
      const context = await dependencies.resolveContext({ mountId: command.mountId, threadId: command.threadId, runId: command.runId });
      await dependencies.runtime.cancel(context);
    },

    async decide(command: Extract<ChatClientCommand, { type: "approval.decide" }>): Promise<ChatServerEvent> {
      assertVersion(command.version);
      const context = await dependencies.resolveContext({ mountId: command.mountId, threadId: command.threadId, runId: command.runId });
      await dependencies.approvals.decide({ context, challengeId: command.challengeId, decision: command.decision });
      return dependencies.store.appendEvent(context, {
        type: "approval.resolved", challengeId: command.challengeId, decision: command.decision,
      });
    },
  };
}

function assertVersion(version: string): asserts version is typeof AGENT_MOUNT_CHAT_VERSION {
  if (version !== AGENT_MOUNT_CHAT_VERSION) throw new AgentMountError("unsupported_binding");
}

function assertContent(content: readonly ChatContentPart[], maxTextChars: number): void {
  if (!Array.isArray(content) || content.length === 0 || content.length > 32) throw new AgentMountError("invalid_argument");
  let characters = 0;
  for (const part of content) {
    if (part.type === "text") characters += [...part.text].length;
    else if (part.type !== "attachment_ref" || !part.attachmentId) throw new AgentMountError("invalid_argument");
  }
  if (characters > maxTextChars) throw new AgentMountError("invalid_argument");
}

function assertOrderedEvents(
  events: readonly ChatServerEvent[], mountId: string, threadId: string, afterSequence: number,
): void {
  let previous = afterSequence;
  for (const event of events) {
    if (event.version !== AGENT_MOUNT_CHAT_VERSION || event.mountId !== mountId || event.threadId !== threadId || event.sequence <= previous) {
      throw new AgentMountError("environment_unavailable", "Invalid replay returned by environment");
    }
    previous = event.sequence;
  }
}
