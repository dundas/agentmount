import {
  createChatBinding,
  type AcceptedTurn,
  type ChatBindingStore,
  type ChatEventBody,
  type ChatRuntime,
  type ChatServerEvent,
} from "@agentmount/contracts/chat";
import type { MountReference, ResolvedMountContext } from "@agentmount/contracts";

/**
 * Application integration skeleton. Replace every repository/runtime method
 * with the environment's durable implementation; do not keep authority in a
 * WebSocket connection or provider session.
 */
export function createEnvironmentChatBinding(input: {
  resolveMount(reference: MountReference): Promise<ResolvedMountContext>;
  store: ChatBindingStore;
  runtime: ChatRuntime;
  decideApproval(context: ResolvedMountContext, challengeId: string, decision: "approve" | "deny"): Promise<void>;
}) {
  return createChatBinding({
    resolveContext: input.resolveMount,
    store: input.store,
    runtime: input.runtime,
    approvals: {
      decide: ({ context, challengeId, decision }) => input.decideApproval(context, challengeId, decision),
    },
    maxTextChars: 32_000,
    maxReplayEvents: 200,
  });
}

/** Persisted events are what transports send; provider-private events stay behind the runtime adapter. */
export async function forwardPersistedEvents(
  binding: ReturnType<typeof createEnvironmentChatBinding>,
  turn: AcceptedTurn,
  send: (event: ChatServerEvent) => Promise<void>,
): Promise<void> {
  for await (const event of binding.dispatch(turn)) await send(event);
}

// A provider adapter should translate its native stream into only these bodies.
export async function* exampleRuntimeEvents(): AsyncIterable<ChatEventBody> {
  yield { type: "run.status", phase: "working" };
  yield { type: "message.delta", messageId: "message_opaque", delta: "Working…" };
  yield { type: "message.completed", messageId: "message_opaque", content: "Done." };
  yield { type: "run.completed" };
}
