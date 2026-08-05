# Agent Mount Contract

> A portable, permissioned contract for mounting an AI agent into an application or integration.

An **agent mount** is an explicit, revocable installation of one portable agent
into one environment account for one authorized principal. It carries bounded
functionality and resource permissions; it does not give the agent an ambient
host credential.

This project defines the transport-neutral `agent-mount/v1` contract and its
conformance fixtures. It is designed for first-party applications (such as a
workspace, conversation app, or trading product) and adapted integrations (such
as Slack, GitHub, or Shopify).

## Model

```text
portable agent + environment account + principal + release + grant = mount
```

An environment adapter owns its native credentials, resources, approval policy,
and side effects. The agent proposes a typed action; the environment validates
the active grant and resource bounds, obtains any required native approval, and
executes the action exactly once.

## Contract layers

- **Identity and consent:** provided by a host identity system.
- **Agent Mount Contract:** mount lifecycle, manifest, grants, normalized events,
  typed action proposals/results, and conformance requirements.
- **Transport:** optional; the schemas can be carried over HTTP, queues, or a
  signed delivery protocol such as ADMP.
- **Environment adapter:** translates an app or integration's native events and
  APIs without exposing its credentials to the agent runtime.

## Reusable bindings

The draft package exposes three dependency-light entry points:

- `@agentmount/contracts` — shared mount context, functionality, invocation,
  authorization, result, and stable-error types.
- `@agentmount/contracts/chat` — provider-neutral turn submission and durable,
  resumable chat events.
- `@agentmount/contracts/mcp` — middleware that projects granted manifest
  functionality into MCP tools while keeping mount authority server-derived.

Chat and MCP are optional interfaces of an environment mount. Chat
authentication, MCP connection authentication, functionality grants, and
native-effect authorization remain separate authorities.

See [`examples/chat-binding.ts`](examples/chat-binding.ts) and
[`examples/mcp-binding.ts`](examples/mcp-binding.ts) for integration skeletons.

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

## License

[MIT](LICENSE)
