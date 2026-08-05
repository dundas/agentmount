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

## Conformance

An adapter must prove installation consent, event normalization, grant/resource
denial, effect approval, idempotency, independent revocation, adapter rollback,
and secret-negative behavior. A conforming adapted integration must use the
same lifecycle as a first-party environment.
