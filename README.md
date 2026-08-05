# Agent Mount Contract

> Compile a portable agent against an application's functionality, then mount
> it with revocable runtime authority.

AgentMount links an `AgentSource` against one integrity-pinned
`EnvironmentManifest` to produce a deterministic `MountArtifact`. Installing
that artifact creates an explicit, revocable mount for one environment account
and principal. Mutable grants, consent, credentials, provider sessions, epochs,
and run generations never enter the portable artifact.

This project defines the transport-neutral `agent-mount/v1` contract and its
conformance fixtures. It is designed for first-party applications (such as a
workspace, conversation app, or trading product) and adapted integrations (such
as Slack, GitHub, or Shopify).

## Model

```text
AgentSource + EnvironmentManifest  --compile/link-->  MountArtifact
MountArtifact + principal consent  --install------>  Mount + CapabilityGrant
Mount + artifact/epoch/generation  --activate----->  ResolvedMountContext
Invocation + exact authorization   --effect------->  environment-owned result
```

An environment adapter owns its native credentials, resources, approval policy,
and side effects. The agent proposes a typed action; the environment validates
the active grant and resource bounds, obtains any required native approval, and
executes the action exactly once.

## Contract layers

- **Identity and consent:** provided by a host identity system.
- **Agent Mount Contract:** deterministic linking, artifact integrity, mount
  lifecycle, grants, runtime fencing, typed functionality, and conformance.
- **Transport:** optional; the schemas can be carried over HTTP, queues, or a
  signed delivery protocol such as ADMP.
- **Environment adapter:** translates an app or integration's native events and
  APIs without exposing its credentials to the agent runtime.

## Reusable bindings

The draft is one dependency-light package with explicit subpath exports:

- `@agentmount/contracts` — shared mount context, functionality, invocation,
  authorization, result, and stable-error types.
- `@agentmount/contracts/compiler` — deterministic link, manifest/artifact
  digests, publisher-proof attachment, and artifact-hygiene validation.
- `@agentmount/contracts/runtime` — the environment-implemented activation,
  invocation, and intent-reconciliation ABI.
- `@agentmount/contracts/chat` — provider-neutral turn submission and durable,
  resumable chat events ordered by `(generation, sequence)`.
- `@agentmount/contracts/mcp` — middleware that projects granted manifest
  functionality into MCP tools while keeping mount authority server-derived;
  its `registerAgentMountMcpToolsAsync` startup call must be awaited because it
  validates manifest and publisher integrity before registering only the
  artifact-linked functionality.
- `@agentmount/contracts/conformance` — product-neutral v1 fixture and harness
  interfaces shared by consumer environments.

These exports do not depend on AG-UI, MCP, ACP, or a policy SDK. Wire-specific
SDK adapters are separate, additive packages after the core contract is proven
by two environments.

Chat and MCP are optional interfaces of an environment mount. Chat
authentication, MCP connection authentication, functionality grants, and
native-effect authorization remain separate authorities.

See [`examples/chat-binding.ts`](examples/chat-binding.ts) and
[`examples/mcp-binding.ts`](examples/mcp-binding.ts) for integration skeletons,
and [`examples/compile-mount.ts`](examples/compile-mount.ts) for deterministic
linking. The [consumer integration map](spec/consumer-integrations.md) records
the Circle Computer and Infinitrade extraction boundaries.

## Status

`agent-mount/v1` is a draft contract. See [the specification](spec/agent-mount-v1.md).
It is not an OAuth replacement or a generic authorization protocol.

## Principles

1. Explicit install and consent.
2. Least-privilege, resource-bounded grants.
3. Typed actions—not an unrestricted `execute` permission.
4. Environment-owned application effects and approvals.
5. Per-mount isolation and independent revocation.
6. Versioned manifests, adapter integrity, and conformance tests.
7. Compiled artifacts contain immutable linked content, never mutable authority.

## v1 boundary

v1 requires synchronous revocation validation before effects. Cached/offline
authorization, hosted registries, marketplaces, ACP, A2A, AG-UI SDK bindings,
MCP SDK servers, and external policy engines are deferred adapters or later
profiles. Environment audit records remain product-owned; the shared outcome
carries only an opaque `auditId`.

### Draft migration note

`0.1.0-draft.1` intentionally replaces the synchronous
`registerAgentMountMcpTools` draft API with
`registerAgentMountMcpToolsAsync`. Callers must update the import and await it
during startup. No compatibility alias is provided because silently ignoring a
Promise could expose tools after server readiness or hide validation failures.

## License

[MIT](LICENSE)
