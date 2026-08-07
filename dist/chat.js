// src/chat.ts
import {
  AgentMountError,
  argumentBindingDigest
} from "./core.js";
var AGENT_MOUNT_CHAT_VERSION = "agent-mount.chat/v1";
function createChatBinding(dependencies) {
  const maxTextChars = dependencies.maxTextChars ?? 32000;
  const maxReplayEvents = dependencies.maxReplayEvents ?? 200;
  return {
    async submit(command) {
      assertVersion(command.version);
      assertContent(command.content, maxTextChars);
      const context = await dependencies.resolveContext({ mountId: command.mountId, ...command.threadId ? { threadId: command.threadId } : {} });
      const bindingDigest = await argumentBindingDigest(command.content);
      const accepted = await dependencies.store.acceptTurn({
        context,
        clientTurnId: command.clientTurnId,
        idempotencyKey: command.idempotencyKey,
        content: command.content,
        bindingDigest
      });
      let acceptedEvent;
      if (!accepted.replayed) {
        acceptedEvent = await dependencies.store.appendEvent(accepted.context, {
          type: "run.accepted",
          clientTurnId: accepted.clientTurnId,
          replayed: false
        });
      }
      return { turn: accepted, ...acceptedEvent ? { acceptedEvent } : {} };
    },
    async* dispatch(turn) {
      if (turn.replayed)
        return;
      for await (const body of dependencies.runtime.dispatch(turn)) {
        yield await dependencies.store.appendEvent(turn.context, body);
      }
    },
    async replay(command) {
      assertVersion(command.version);
      const limit = Math.min(command.limit ?? maxReplayEvents, maxReplayEvents);
      if (!isCursor(command.after) || limit < 1) {
        throw new AgentMountError("invalid_argument");
      }
      const context = await dependencies.resolveContext({ mountId: command.mountId, threadId: command.threadId });
      if (command.after.generation > context.runGeneration)
        throw new AgentMountError("run_generation_stale");
      const events = await dependencies.store.replay({ mountId: command.mountId, threadId: command.threadId }, command.after, limit);
      assertOrderedEvents(events, command.mountId, command.threadId, command.after, context.runGeneration);
      return events;
    },
    async cancel(command) {
      assertVersion(command.version);
      const context = await dependencies.resolveContext({ mountId: command.mountId, threadId: command.threadId, runId: command.runId });
      await dependencies.runtime.cancel(context);
    },
    async decide(command) {
      assertVersion(command.version);
      const context = await dependencies.resolveContext({ mountId: command.mountId, threadId: command.threadId, runId: command.runId });
      await dependencies.approvals.decide({ context, challengeId: command.challengeId, decision: command.decision });
      return dependencies.store.appendEvent(context, {
        type: "approval.resolved",
        challengeId: command.challengeId,
        decision: command.decision
      });
    }
  };
}
function assertVersion(version) {
  if (version !== AGENT_MOUNT_CHAT_VERSION)
    throw new AgentMountError("unsupported_binding");
}
function assertContent(content, maxTextChars) {
  if (!Array.isArray(content) || content.length === 0 || content.length > 32)
    throw new AgentMountError("invalid_argument");
  let characters = 0;
  for (const part of content) {
    if (part.type === "text")
      characters += [...part.text].length;
    else if (part.type !== "attachment_ref" || !part.attachmentId)
      throw new AgentMountError("invalid_argument");
  }
  if (characters > maxTextChars)
    throw new AgentMountError("invalid_argument");
}
function assertOrderedEvents(events, mountId, threadId, after, currentGeneration) {
  let previous = after;
  for (const event of events) {
    const cursor = { generation: event.runGeneration, sequence: event.sequence };
    if (event.version !== AGENT_MOUNT_CHAT_VERSION || event.mountId !== mountId || event.threadId !== threadId || !isCursor(cursor) || cursor.sequence < 1 || cursor.generation > currentGeneration || compareCursor(cursor, previous) <= 0) {
      throw new AgentMountError("environment_unavailable", "Invalid replay returned by environment");
    }
    previous = cursor;
  }
}
function isCursor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const cursor = value;
  return Number.isInteger(cursor.generation) && Number(cursor.generation) >= 0 && Number.isInteger(cursor.sequence) && Number(cursor.sequence) >= 0;
}
function compareCursor(left, right) {
  return left.generation === right.generation ? left.sequence - right.sequence : left.generation - right.generation;
}
export {
  createChatBinding,
  AGENT_MOUNT_CHAT_VERSION
};
