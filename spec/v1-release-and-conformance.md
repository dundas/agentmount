# AgentMount v1 release and conformance guide

This is the canonical developer guide for the current `0.1.0-draft.1` contract.
It explains what the SDK supplies today, what an environment must supply, and
the evidence required before calling the contract stable.

## What the SDK includes

`@agentmount/contracts` exports the transport-neutral contract and these
integration entry points:

| Import | Use it for |
|---|---|
| `@agentmount/contracts` | mount, manifest, invocation, authorization, result, and stable-error types |
| `@agentmount/contracts/compiler` | deterministic linking, digests, publisher-proof verification, and artifact hygiene |
| `@agentmount/contracts/runtime` | activation, invocation, and intent-reconciliation ABI |
| `@agentmount/contracts/mcp` | async MCP projection of artifact-linked functionality |
| `@agentmount/contracts/conformance` | the required v1 case inventory and executable suite runner |

The SDK owns the shared case inventory and runner. It intentionally does not
invent an environment's mounts, grants, native effects, audit system, or test
fixtures. Each environment provides those through its conformance suite.

## Run conformance in one test

Create one executor per exported case. An executor must perform the real
environment setup and assert the stated invariant. Do not branch on an
environment name in the shared runner.

```ts
import {
  assertAgentMountV1Conformance,
  type AgentMountV1ConformanceCase,
} from "@agentmount/contracts/conformance";

const cases: Record<AgentMountV1ConformanceCase, () => Promise<void>> = {
  "compile.link_narrows": async () => { /* assert unavailable functionality is rejected */ },
  // Implement every remaining required case.
};

await assertAgentMountV1Conformance({
  environmentId: "example-environment",
  cases,
});
```

`assertAgentMountV1Conformance` executes all required cases in a deterministic
order and throws one `AgentMountConformanceError` containing every failed case.
Use `runAgentMountV1Conformance` instead when a CI reporter needs the complete
machine-readable result without throwing.

An environment is **not conformant** merely because it imports the types or
registers empty callbacks. The callbacks must test real mount lifecycle,
revocation, generation, effect, replay, and intent behavior. The same suite
must run without product-specific branches against at least two environments.

### Reuse the shared compile cases

The SDK provides the four `compile.*` executors and a product-neutral reference
fixture. Compose them with your environment's remaining case executors instead
of reimplementing deterministic linking, manifest binding, or artifact hygiene.

```ts
import {
  createAgentMountV1CompileConformanceExecutors,
  createAgentMountV1ReferenceFixture,
} from "@agentmount/contracts/conformance";

const fixture = await createAgentMountV1ReferenceFixture();
const compileCases = createAgentMountV1CompileConformanceExecutors(fixture, {
  compile: environmentAdapter.compile,
});
```

The reference fixture includes idempotency keys in every idempotency-required
input schema. It is an SDK test fixture, not a portable installation record or
an environment's production manifest.

## MCP integration requirements

`registerAgentMountMcpToolsAsync` must be awaited during server startup. It
validates the manifest and exact `MountArtifact.artifactDigest` publisher proof
before it registers any artifact-linked tool.

For every call:

1. Resolve mutable state from the connection-bound `MountReference`; never from
   MCP tool arguments.
2. Let the environment-owned `FunctionalityInvoker` enforce the exact
   functionality grant and native policy before execution.
3. For `kind: "effect"`, provide independent effect authorization bound to the
   canonical domain argument digest.
4. Map native failures to a typed `AgentMountError` or return the corresponding
   `FunctionalityOutcome`. Do not leak raw environment errors into the generic
   fallback path.

### Idempotency schema rule

For an `idempotencyRequired: true` MCP functionality, its `inputSchema` must
accept a required `idempotencyKey` string with length 16–128. The MCP binding
reads that key from the wire arguments, passes it on the invocation envelope,
and removes it before calculating `argumentBindingDigest` over domain
arguments. Read-only functionality normally omits this field.

This is intentional: the key controls replay semantics but must not alter the
authorization binding for the domain operation.

## `0.1.0` stability checklist

Do not call the draft stable until each item has retained, reproducible
evidence:

- [ ] The public types, stable error codes, and subpath exports are frozen; any
      proposed incompatible change has an explicit migration and conformance
      evidence.
- [ ] `bun run prepack` passes from a clean checkout.
- [ ] At least two independent environments pass every v1 conformance case
      through the same shared runner, without product-name branches.
- [ ] Each MCP consumer proves manifest/publisher verification happens before
      tool exposure, connection-derived context is used, and effect authority
      remains separate from connection authentication.
- [ ] Every idempotency-required MCP schema follows the schema rule above, and
      adapters normalize native errors into the typed outcome path.
- [ ] A release-candidate soak proves the consumer's real flag/cutover path,
      including revocation and retry behavior. Any known release prerequisite
      (such as a real mount store or audit-safe context lookup) is resolved.
- [ ] The release pipeline publishes the compiled `dist/` artifacts and records
      the exact version, source commit, and validation evidence.

For the current Circle adoption, the shadow implementation may merge with its
feature flag off, but its production flag flip remains release-blocked until
the real mount store, non-audited context-resolution path, key distribution,
conformance execution, and soak evidence are complete. See the consumer's
adoption PRD for its environment-specific rollout record.
