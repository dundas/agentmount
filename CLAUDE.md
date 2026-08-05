# CLAUDE.md

This file provides operating guidance for agents working in the AgentMount repository.

## Project

AgentMount defines the transport-neutral `agent-mount/v1` contract for compiling a portable agent against an integrity-pinned environment manifest and installing the resulting artifact with revocable runtime authority.

## Commands

```bash
bun install
bun run check
bun test
bun run build
bun run prepack
```

## Architecture Boundaries

- `src/core.ts` owns shared mount, grant, invocation, authorization, result, and stable-error contracts.
- `src/compiler.ts` owns deterministic linking, digests, publisher proofs, and artifact hygiene.
- `src/runtime.ts` owns the environment-implemented activation, invocation, and reconciliation ABI.
- `src/chat.ts` and `src/mcp.ts` are optional, provider-neutral environment bindings.
- `src/conformance.ts` exposes product-neutral fixtures and harness interfaces.
- Environment adapters own credentials, native approvals, resources, side effects, and audit records.

## Non-Negotiable Invariants

- Portable artifacts contain immutable linked content only, never mutable authority or credentials.
- Runtime context is server-derived and fenced by artifact digest, epoch, and generation.
- Functionality is typed, explicitly granted, and resource-bounded.
- Authorization is exact and effects execute at most once.
- The core contract remains transport-neutral and does not depend on MCP, AG-UI, ACP, or a policy SDK.

## Brain Operations

- Agent ID: `agentmount`
- Reports to: `decisive`
- Read `brain/AGENTS.md` and `memory/MEMORY.md` at session start.
- Check inbox: `bun .agents/skills/cross-brain-message/brain-msg.ts inbox`
- Discover peers: `bun .agents/skills/cross-brain-message/brain-msg.ts agents`
- Send messages: `bun .agents/skills/cross-brain-message/brain-msg.ts send --to <agent> --type <type> --subject "..." --body '{...}'`
