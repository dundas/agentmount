# Agent Mount Contract: `agent-mount/v1`

## Scope

This contract standardizes the relationship between a portable AI agent and an
**environment**: an application or external integration that hosts the agent
and exposes functionality to it. It standardizes the boundary; it does not
standardize an environment's data model, credential storage, or native APIs.

## Core entities

| Entity | Purpose |
|---|---|
| `AgentSource` | Portable compile-time instructions, model profile, source digest, and requested functionality |
| `EnvironmentManifest` | Versioned, content-digested declaration of functionality and optional bindings |
| `MountArtifact` | Deterministic compiled result linking one source to one environment manifest |
| `AgentMount` | Installation binding agent, release, environment account, principal, adapter digest, and lifecycle |
| `CapabilityGrant` | Revocable, resource-bounded permission set for one mount |
| `MountEvent` | Normalized authenticated inbound event |
| `ActionProposal` | Agent request for one typed environment functionality |
| `ActionResult` | Safe, correlated outcome of an accepted or denied proposal |
| `ChatBinding` | Optional durable conversation/run interface for a mount |
| `McpBinding` | Optional MCP projection of granted environment functionality |

## Lifecycle

```text
source + manifest validated → functionality linked → artifact digested and signed
user consents → artifact installed → mount created → grants activated
event received → event normalized → agent responds/proposes action
proposal validated → native approval (if needed) → effect executed → result
mount suspended/revoked → ingress and future effects denied
```

## Requirements

### Environment manifests

- Are schema-validated, versioned, integrity-pinned, and code-owned.
- `adapterDigest` is the digest of the canonical manifest with
  `adapterDigest` omitted. Implementations must recompute and compare it rather
  than trusting the declared string.
- Declare namespaced functionality such as `slack.message.send` or
  `portfolio.order.propose`.
- Distinguish read, proposal, and effect functionality.
- Must reject unsupported or lossy mappings rather than claiming equivalence.

### Compiled artifacts

- Linking is deterministic and narrowing: every requested functionality must
  exist in the selected manifest, and linking cannot widen the manifest.
- `artifactDigest` is the digest of the canonical `MountArtifact` with
  `artifactDigest` and `publisher` omitted.
- `publisher.signature` signs the `artifactDigest` string. AgentMount accepts an
  owner-managed signer/verifier seam and never holds the publisher private key.
- An artifact contains immutable source and linkage facts only. It must not
  contain a credential, token, consent record, grant, provider session,
  principal, environment account, mount epoch, run generation, authorization,
  or expiry.
- The reference compiler rejects unknown top-level, model-profile, and
  publisher fields and rejects authority/credential-shaped keys recursively.
  Because arbitrary instruction text cannot be proven secret-free by schema,
  the publisher's release pipeline remains responsible for secret scanning
  free-form source content before signing.
- Artifact production and signing remain with the agent release pipeline.
  AgentMount defines linking and verification; it is not a release registry or
  system of record.

### Mounts and grants

- Creation requires verified identity and explicit consent.
- A mount is bound to opaque agent, release, environment, account, principal,
  exact compiled artifact digest, adapter, and policy identities.
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
- Results carry an opaque `auditId`. The environment owns its audit record and
  schema, which may contain product-specific resource fields and must omit
  secret values. AgentMount does not standardize that record in v1.

### Effect authority roles

- The **effect owner** owns the native resource and effect.
- The **effect authorizer** verifies the exact principal, functionality,
  resource, canonical argument digest, mount epoch, run generation, expiry, and
  assurance needed for an effect.
- The **authorization recorder** durably mints, records, and consumes authority.
- Native environments may fill all three roles. In an adapted environment, a
  consent broker may authorize only the assurance level the adapter can prove.
  The adapter itself is never an authority source.
- Broker-attested authorizations must be signed by a key unavailable to the
  adapter. Every broker validation call supplies an explicit inventory of keys
  available to the adapter, even when that inventory is empty. Missing inventory
  and adapter-held signing material both fail closed.

### Revocation and intent resolution

- A synchronous profile consumes authorization and compares the authoritative
  mount epoch in one control-plane transaction immediately before execution.
- v1 defines only the synchronous profile. Cached or offline consumption is
  deferred until a later profile defines observable acceptance reporting and a
  conformance test for its bounded revocation window.
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
- `events.replay` — resume after a durable `{generation, sequence}` cursor;
- `run.cancel` — request cancellation of an active run; and
- `approval.decide` — answer an opaque environment-issued approval challenge.

Server events are:

- `run.accepted`, `run.status`, `run.completed`, and `run.failed`;
- `message.delta` and `message.completed`;
- `functionality.started`, `functionality.completed`, and
  `functionality.failed`;
- `approval.requested` and `approval.resolved`; and
- `artifact.available`.

Every server event has a durable event ID, mount ID, thread ID, run ID,
generation, generation-local sequence, timestamp, and trace ID. Events are
ordered lexicographically by `(generation, sequence)`. Sequence may reset only
when generation increases; it must increase within one generation. Events are
persisted before live fan-out and replayed from the two-part cursor.
Historical cursors may cross into newer generations, but a cursor or returned
event beyond the current authoritative generation fails with
`run_generation_stale`.
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
- Startup verifies the installed artifact publisher proof and registers only
  the intersection of manifest functionality and `linkedFunctionality`.
- The tool preserves the manifest operation kind, schemas, resource policy,
  reversibility, approval mode, idempotency policy, and intent deadline.
- Tool arguments contain domain input plus, when `idempotencyRequired` is true,
  a required `idempotencyKey` string (16–128 characters). The binding removes
  that envelope key before calculating the canonical domain-argument digest.
  Mount, tenant, principal, environment account, runtime, grant, policy, and
  credential fields are server-derived and rejected if presented as arguments.
- An MCP connection credential authenticates the connection only. Every call
  re-resolves the mount, epoch, generation, adapter digest, grant, and policy.
- Effect calls require separate `EffectAuthorization` evidence bound to the
  canonical arguments. Generic MCP or runtime tool approval is insufficient.
- Results use stable Agent Mount errors and bounded, redacted output. An
  ambiguous native effect returns an intent/reference for reconciliation rather
  than encouraging a blind retry.
- Environment adapters normalize native failures into a typed
  `AgentMountError` or `FunctionalityOutcome` before they reach the shared
  binding. Raw environment errors must not rely on the generic unavailable
  fallback when a stable denial or indeterminate outcome is known.

The reference MCP boilerplate deliberately accepts an environment-owned
invoker. The invoker is the policy/effect boundary and must implement grant
evaluation, intent persistence, authorization, execution, audit, and
reconciliation. Registering a handler is not proof those controls exist.

The structural MCP export has no MCP SDK dependency. Tool registration is an
explicitly async startup operation because manifest integrity is verified
before the first tool is exposed. It requires an explicit
adapter signing-key inventory and compares the active context's adapter digest
with the registered manifest before invocation. An official MCP SDK server is
an additive adapter, not part of the v1 core.

## Conformance

The same product-neutral harness must run without product-specific branches
against at least two environments. The `./conformance` export supplies the
case inventory and runner; environments supply the real fixture and executor
for each case. v1 cases cover:

- link narrowing, deterministic artifact digests, manifest-content binding,
  and artifact hygiene;
- ungranted functionality, revoked mounts, stale run generations, forged
  context, broker/adapter key separation, and argument tampering;
- irreversible functionality requiring both L4 and an environment-native
  authorizer;
- idempotent turns, generation-aware replay, and persist-before-fan-out; and
- pending intent transition to `indeterminate` at its declared deadline.

Chat conformance additionally proves durable accept-before-dispatch,
equivalent/conflicting retry, ordered replay, reconnect, stale-generation
denial, provider-event rejection, forged-context denial, and payload-bound
approval decisions.

MCP conformance additionally proves manifest/tool parity, server-derived
context, connection-auth separation, per-call grant checks, argument/resource
denial, effect authorization, broker/adapter key separation, idempotency,
ambiguous-effect reconciliation, and secret-negative results.

## Package and dependency boundary

v1 is one package, `@agentmount/contracts`, with `.`, `./compiler`, `./runtime`,
`./chat`, `./mcp`, and `./conformance` exports. These exports depend only on one
another and contain no AG-UI, MCP, ACP, A2A, policy-engine, registry, or OAuth
SDK. SDK-backed wire adapters and cached authorization profiles are later,
separately installable work.

Product nouns and physical storage stay outside the contract. Boards, cards,
workspaces, orders, positions, provider sessions, database tables, approval UI,
and native audit schemas remain owned by their environments.
