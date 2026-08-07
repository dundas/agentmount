import { type AgentMountErrorCode, type FunctionalityOutcome, type MountReference, type ResolvedMountContext } from "./core.js";
export declare const AGENT_MOUNT_CHAT_VERSION: "agent-mount.chat/v1";
/** Durable replay position. Sequence is monotonic only within one generation. */
export interface StreamCursor {
    generation: number;
    sequence: number;
}
export type ChatContentPart = {
    type: "text";
    text: string;
} | {
    type: "attachment_ref";
    attachmentId: string;
    mediaType?: string;
};
export type ChatClientCommand = {
    version: typeof AGENT_MOUNT_CHAT_VERSION;
    type: "turn.submit";
    mountId: string;
    threadId?: string;
    clientTurnId: string;
    idempotencyKey: string;
    content: readonly ChatContentPart[];
} | {
    version: typeof AGENT_MOUNT_CHAT_VERSION;
    type: "events.replay";
    mountId: string;
    threadId: string;
    after: StreamCursor;
    limit?: number;
} | {
    version: typeof AGENT_MOUNT_CHAT_VERSION;
    type: "run.cancel";
    mountId: string;
    threadId: string;
    runId: string;
} | {
    version: typeof AGENT_MOUNT_CHAT_VERSION;
    type: "approval.decide";
    mountId: string;
    threadId: string;
    runId: string;
    challengeId: string;
    decision: "approve" | "deny";
};
export type ChatEventBody = {
    type: "run.accepted";
    clientTurnId: string;
    replayed: boolean;
} | {
    type: "run.status";
    phase: "queued" | "working" | "awaiting_approval" | "executing";
} | {
    type: "message.delta";
    messageId: string;
    delta: string;
} | {
    type: "message.completed";
    messageId: string;
    content: string;
} | {
    type: "functionality.started";
    invocationId: string;
    functionalityId: string;
} | {
    type: "functionality.completed";
    invocationId: string;
    functionalityId: string;
    outcome: FunctionalityOutcome;
} | {
    type: "functionality.failed";
    invocationId: string;
    functionalityId: string;
    error: AgentMountErrorCode;
} | {
    type: "approval.requested";
    challengeId: string;
    functionalityId: string;
    bindingDigest: string;
    expiresAt: string;
    prompt: string;
} | {
    type: "approval.resolved";
    challengeId: string;
    decision: "approve" | "deny";
} | {
    type: "artifact.available";
    artifactId: string;
    mediaType: string;
    title?: string;
} | {
    type: "run.completed";
} | {
    type: "run.failed";
    error: AgentMountErrorCode;
    retryable: boolean;
};
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
    replay(reference: MountReference & {
        threadId: string;
    }, after: StreamCursor, limit: number): Promise<readonly ChatServerEvent[]>;
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
export declare function createChatBinding(dependencies: ChatBindingDependencies): {
    submit(command: Extract<ChatClientCommand, {
        type: "turn.submit";
    }>): Promise<ChatTurnReceipt>;
    dispatch(turn: AcceptedTurn): AsyncIterable<ChatServerEvent>;
    replay(command: Extract<ChatClientCommand, {
        type: "events.replay";
    }>): Promise<readonly ChatServerEvent[]>;
    cancel(command: Extract<ChatClientCommand, {
        type: "run.cancel";
    }>): Promise<void>;
    decide(command: Extract<ChatClientCommand, {
        type: "approval.decide";
    }>): Promise<ChatServerEvent>;
};
