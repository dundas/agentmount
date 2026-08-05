# Agent Mount Contract: `agent-mount/v1`

## Scope

This contract standardizes the relationship between a portable AI agent and an
**environment**: an application or external integration that hosts the agent
and exposes functionality to it. It standardizes the boundary; it does not
standardize an environment's data model, credential storage, or native APIs.

## Core entities

| Entity | Purpose |
|---|---|
| `EnvironmentManifest` | Versioned adapter declaration of events, functionality, resource schemas, and approval modes |
| `AgentMount` | Installation binding agent, release, environment account, principal, adapter digest, and lifecycle |
| `CapabilityGrant` | Revocable, resource-bounded permission set for one mount |
| `MountEvent` | Normalized authenticated inbound event |
| `ActionProposal` | Agent request for one typed environment functionality |
| `ActionResult` | Safe, correlated outcome of an accepted or denied proposal |
| `ChatBinding` | Optional durable conversation/run interface for a mount |
| `McpBinding` | Optional MCP projection of granted environment functionality |

## Lifecycle

```text
manifest registered → user consents → mount created → grants activated
event received → event normalized → agent responds/proposes action
proposal validated → native approval (if needed) → effect executed → result
mount suspended/revoked → ingress and future effects denied
```

## Requirements

### Environment manifests

- Are schema-validated, versioned, integrity-pinned, and code-owned.
- Declare namespaced functionality such as `slack.message.send` or
  `portfolio.order.propose`.
- Distinguish read, proposal, and effect functionality.
- Must reject unsupported or lossy mappings rather than claiming equivalence.

### Mounts and grants

- Creation requires verified identity and explicit consent.
- A mount is bound to opaque agent, release, environment, account, principal,
  adapter, and policy identities.
- Grants name only allowed functionality and resource bounds; they do not
  contain host OAuth tokens, API keys, or browser sessions.
- Installation and effects are idempotent and recoverable across retries.

### Events and actions

- The adapter authenticates native events and supplies a bounded,
  idempotency-keyed `MountEvent`.
- The runtime can return a typed `ActionProposal`, never a direct privileged
  host API request.
- Immediately before a native effect, the environment revalidates mount,
  functionality, resource, arguments, approval, and mutable preconditions.
- Generic runtime-tool approval does not authorize an environment-native effect.
- Results and audit evidence include mount, adapter, grant/policy version,
  resource reference, idempotency key, and approval reference where relevant;
  they omit secret values.

### Effect authority roles

- The **effect owner** owns the native resource and effect.
- The **effect authorizer** verifies the exact principal, functionality,
  resource, canonical argument digest, mount epoch, expiry, and assurance needed
  for an effect.
- The **authorization recorder** durably mints, records, and consumes authority.
- Native environments may fill all three roles. In an adapted environment, a
  consent broker may authorize only the assurance level the adapter can prove.
  The adapter itself is never an authority source.
- Broker-attested authorizations must be signed by a key unavailable to the
  adapter. Conformance must reject adapter-held signing material.

### Revocation and intent resolution

- A synchronous profile consumes authorization and compares the authoritative
  mount epoch in one control-plane transaction immediately before execution.
- A cached profile may consume locally, but its honest revocation bound is its
  authorization TTL. Effects accepted inside that window are reported.
- Minting and authoritative epoch changes remain control-plane operations in
  both profiles. Cached local consumption is not authoritative epoch ownership.
- Every effect functionality declares an intent-resolution deadline. A sweeper
  moves abandoned `pending` intents to `indeterminate` at that deadline.
  Reversible effects follow their declared retry policy; irreversible effects
  require manual reconciliation.
- Irreversible functionality requires conformance level L4 and an
  environment-native authorizer. Broker-attested adapted environments cannot
  expose it.

### Isolation and revocation

- Threads, ingress, grants, credentials, and default memory are mount-scoped.
- Revoking one mount must not change another mount of the same agent.
- Revocation fences in-flight work before effect execution and denies/cancels
  pending approvals.

## Transport binding

The canonical schemas are transport-neutral. A transport binding may add
authentication, delivery, and retry semantics, but it cannot make a message
signature or delivery credential an application-effect grant. Recipients must
validate the `agent-mount/v1` body and stored mount authorization.

## Chat binding: `agent-mount.chat/v1`

The optional chat binding is a provider-neutral interface between an
environment's user-facing conversation surface and a mounted agent. It does not
standardize UI layout or make a runtime provider's session canonical.

Client commands are:

- `turn.submit` — submit one bounded message with a stable client turn ID and
  idempotency key;
- `events.replay` — resume after a durable per-thread sequence cursor;
- `run.cancel` — request cancellation of an active run; and
- `approval.decide` — answer an opaque environment-issued approval challenge.

Server events are:

- `run.accepted`, `run.status`, `run.completed`, and `run.failed`;
- `message.delta` and `message.completed`;
- `functionality.started`, `functionality.completed`, and
  `functionality.failed`;
- `approval.requested` and `approval.resolved`; and
- `artifact.available`.

Every server event has a durable event ID, monotonically increasing per-thread
sequence, mount ID, thread ID, run ID, generation, timestamp, and trace ID.
Events are persisted before live fan-out and replayed in sequence order.
Provider-private events never appear in this vocabulary.

The client may reference only a mount, thread, run, turn, or challenge that it
is allowed to address. The server derives agent, release, principal,
environment account, mount epoch, adapter digest, grant, and policy from stored
authority. Equivalent turn retries return the original run; reuse of the same
idempotency key with a different canonical message returns
`idempotency_conflict`.

An approval challenge is an opaque reference to server-side evidence bound to
the exact functionality, canonical argument digest, resource, mount epoch,
principal, expiry, and assurance. A boolean, proposal ID, chat session, or
runtime approval cannot independently authorize an environment-native effect.

## MCP binding: `agent-mount.mcp/v1`

The optional MCP binding projects currently granted manifest functionality as
MCP tools. It does not create a second tool catalog or privilege model.

- One MCP tool maps to one namespaced functionality ID.
- The tool preserves the manifest operation kind, schemas, resource policy,
  reversibility, approval mode, idempotency policy, and intent deadline.
- Tool arguments contain domain input only. Mount, tenant, principal,
  environment account, runtime, grant, policy, and credential fields are
  server-derived and rejected if presented as arguments.
- An MCP connection credential authenticates the connection only. Every call
  re-resolves the mount, epoch, generation, adapter digest, grant, and policy.
- Effect calls require separate `EffectAuthorization` evidence bound to the
  canonical arguments. Generic MCP or runtime tool approval is insufficient.
- Results use stable Agent Mount errors and bounded, redacted output. An
  ambiguous native effect returns an intent/reference for reconciliation rather
  than encouraging a blind retry.

The reference MCP boilerplate deliberately accepts an environment-owned
invoker. The invoker is the policy/effect boundary and must implement grant
evaluation, intent persistence, authorization, execution, audit, and
reconciliation. Registering a handler is not proof those controls exist.

## Conformance

An adapter must prove installation consent, event normalization, grant/resource
denial, effect approval, idempotency, independent revocation, adapter rollback,
and secret-negative behavior. A conforming adapted integration must use the
same lifecycle as a first-party environment.

Chat conformance additionally proves durable accept-before-dispatch,
equivalent/conflicting retry, ordered replay, reconnect, stale-generation
denial, provider-event rejection, forged-context denial, and payload-bound
approval decisions.

MCP conformance additionally proves manifest/tool parity, server-derived
context, connection-auth separation, per-call grant checks, argument/resource
denial, effect authorization, broker/adapter key separation, idempotency,
ambiguous-effect reconciliation, and secret-negative results.
