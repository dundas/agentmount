import { describe, expect, test } from "bun:test";
import { AGENT_MOUNT_VERSION, AgentMountError, type ResolvedMountContext } from "../src/core.ts";
import { AGENT_MOUNT_CHAT_VERSION, createChatBinding, type ChatServerEvent } from "../src/chat.ts";

const context: ResolvedMountContext = {
  protocolVersion: AGENT_MOUNT_VERSION,
  mountId: "mount_test", environmentId: "test", environmentAccountId: "account_test",
  agentId: "agent_test", releaseId: "release_test", principalId: "principal_test",
  adapterDigest: "sha256:test", policyVersion: "policy_test", mountEpoch: 2,
  threadId: "thread_test", runId: "run_test", runGeneration: 3, traceId: "trace_test",
};

describe("chat binding", () => {
  test("persists runtime events before yielding them", async () => {
    const order: string[] = [];
    let sequence = 0;
    const binding = createChatBinding({
      resolveContext: async () => context,
      store: {
        acceptTurn: async (input) => ({ ...input, replayed: false }),
        appendEvent: async (resolved, body) => {
          order.push(`persist:${body.type}`);
          return {
            version: AGENT_MOUNT_CHAT_VERSION, eventId: `event_${++sequence}`, sequence,
            mountId: resolved.mountId, threadId: resolved.threadId, runId: resolved.runId,
            runGeneration: resolved.runGeneration, traceId: resolved.traceId,
            occurredAt: "2026-08-05T00:00:00.000Z", body,
          };
        },
        replay: async () => [],
      },
      runtime: {
        async *dispatch() { yield { type: "message.completed", messageId: "message_test", content: "done" } as const; },
        cancel: async () => undefined,
      },
      approvals: { decide: async () => undefined },
    });
    const receipt = await binding.submit({
      version: AGENT_MOUNT_CHAT_VERSION, type: "turn.submit", mountId: context.mountId,
      clientTurnId: "turn_test", idempotencyKey: "idempotency_test_1", content: [{ type: "text", text: "hello" }],
    });
    expect(receipt.acceptedEvent?.body.type).toBe("run.accepted");
    for await (const event of binding.dispatch(receipt.turn)) order.push(`yield:${event.body.type}`);
    expect(order).toEqual(["persist:run.accepted", "persist:message.completed", "yield:message.completed"]);
  });

  test("rejects an invalid replay sequence returned by an environment", async () => {
    const invalid = {
      version: AGENT_MOUNT_CHAT_VERSION, eventId: "event_test", sequence: 1,
      mountId: context.mountId, threadId: context.threadId, runId: context.runId,
      runGeneration: context.runGeneration, traceId: context.traceId,
      occurredAt: "2026-08-05T00:00:00.000Z", body: { type: "run.completed" },
    } as ChatServerEvent;
    const binding = createChatBinding({
      resolveContext: async () => context,
      store: {
        acceptTurn: async (input) => ({ ...input, replayed: false }),
        appendEvent: async () => invalid,
        replay: async () => [invalid],
      },
      runtime: { async *dispatch() {}, cancel: async () => undefined },
      approvals: { decide: async () => undefined },
    });
    await expect(binding.replay({
      version: AGENT_MOUNT_CHAT_VERSION, type: "events.replay", mountId: context.mountId,
      threadId: context.threadId, afterSequence: 5,
    })).rejects.toBeInstanceOf(AgentMountError);
  });
});
