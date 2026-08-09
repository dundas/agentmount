# Consumer integration map

AgentMount v1 is extracted from two independently implemented environment
boundaries. This document prevents product-specific schemas from leaking into
the shared contract and identifies the executable seams each consumer should
adopt.

## Circle Computer

### Extract or map to AgentMount

- `src/server/circleMcpAuth.ts`: stable denial codes and per-call revocation
  become `AgentMountErrorCode` and `mountEpoch` semantics.
- `src/server/circleMcpAuthority.ts`: its server-derived call context maps to
  `ResolvedMountContext`; the installation record supplies `artifactDigest`
  and `runtimeSessionGeneration` carries `runGeneration`.
- `src/server/circleMcpServer.ts`: its authorize-before-canvas-commit sequence
  implements the `FunctionalityInvoker` effect boundary. Tool registration can
  move behind awaited `registerAgentMountMcpToolsAsync` startup registration.
- Its mutation idempotency fingerprint maps to canonical argument binding and
  the shared idempotency contract. Each idempotency-required MCP input schema
  must accept `idempotencyKey` (16–128 characters); the shared binding removes
  it before the domain-argument digest.
- Its adapter maps known native errors into Circle's typed authorization error
  before invoking AgentMount, so the shared invoker can produce stable denied
  or indeterminate outcomes instead of a generic unavailable result.

### Retain in Circle Computer

- ES256 grant minting, verification, rotation, and storage
- board, card, canvas, artifact, email, and status schemas
- provisioning, Machine lifecycle, and connection-vault behavior
- native approval UI and decision scopes
- audit tables and product-specific audit fields

`boardId`, card types, Circle UI phases, and `once | session | always` are not
AgentMount vocabulary.

## Infinitrade

### Extract or map to AgentMount

- `src/agent-environment/workspace/events.ts`: persist-before-fan-out and
  normalized event boundaries map to the chat binding.
- `src/agent-environment/workspace/types.ts`: `clientTurnId` supplies turn
  idempotency and run generation supplies the runtime fence.
- `src/agent-environment/providers/provider-broker.ts`: provider replacement
  proves stale-generation refusal and generation-aware replay.
- Its durable counter is generation-local, so AgentMount replay uses
  `{generation, sequence}` rather than a global sequence number.

### Retain in Infinitrade

- tenant, workspace, thread, deployment, and provider-session storage
- provider selection, readiness, replacement, and cancellation
- trading policy, proposals, orders, positions, and broker integrations
- BFF routes, authentication, and database schema
- native audit records

The legacy WebSocket/CLI event grammar, provider-private deltas, `workspaceId`,
and internal `switching` state are not AgentMount vocabulary.

## Shared conformance rule

Both products must run the same `@agentmount/contracts/conformance` cases with
no product-name branch in the harness. They may use different physical fence
carriers: Circle Computer binds generation to its runtime connection, while
Infinitrade binds it to a run. The shared invariant is that a credential or
invocation carrying a non-current generation is denied before any native
effect.

See the [v1 release and conformance guide](v1-release-and-conformance.md) for
the shared test-runner contract and stable-release checklist.
