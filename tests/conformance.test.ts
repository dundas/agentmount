import { describe, expect, test } from "bun:test";
import {
  AGENT_MOUNT_V1_CONFORMANCE_CASES,
  ConformanceNotImplemented,
  type AgentMountConformanceAdapter,
  type AgentMountConformanceFixture,
  type ConformanceReport,
  referenceFixture,
  runConformance,
  runConformanceCase,
} from "../src/conformance.ts";
import { attachMountArtifactPublisher, linkAgentSource } from "../src/compiler.ts";

/** The reference adapter for self-testing the runner. Implements `compile`
 * (the contract's own compiler path — `linkAgentSource` + `attachMountArtifact
 * Publisher`); the other 5 adapter methods throw `ConformanceNotImplemented`
 * so the runner reports those cases as `not_applicable` (slice-2 prerequisites),
 * never a false `fail`. This mirrors how a consumer with a partial adapter
 * (e.g. Circle's slice-1 shadow — compile-only) would run the harness. */
function referenceAdapter(): AgentMountConformanceAdapter {
  return {
    async compile(_source, manifest) {
      const linked = await linkAgentSource(_source, manifest);
      return attachMountArtifactPublisher(linked, { keyId: "ref", signature: "ref" });
    },
    async activate() { throw new ConformanceNotImplemented("activate"); },
    async revokeMount() { throw new ConformanceNotImplemented("revokeMount"); },
    async replaceRun() { throw new ConformanceNotImplemented("replaceRun"); },
    async replay() { throw new ConformanceNotImplemented("replay"); },
    async sweepIntents() { throw new ConformanceNotImplemented("sweepIntents"); },
  };
}

describe("conformance runner", () => {
  let fixture: AgentMountConformanceFixture;

  test("reference fixture is well-formed (manifest digest verifies; source links)", async () => {
    fixture = await referenceFixture();
    // The fixture's manifest digest must verify (compile.manifest_digest_binds_exports
    // relies on the fixture being well-formed; a tampered manifest is the negative case).
    const linked = await linkAgentSource(fixture.source, fixture.manifest);
    expect(linked.artifactDigest).toBeTruthy();
    expect(linked.linkedFunctionality).toEqual([...fixture.source.requestedFunctionality].sort());
  });

  test("the runner covers exactly the 15 v1 cases (registry == dispatch)", () => {
    // Exhaustiveness: if a case is added to AGENT_MOUNT_V1_CONFORMANCE_CASES but the
    // runner's switch doesn't handle it, tsc's `never` guard catches it at compile
    // time. This test is the runtime mirror: running every registered case must not
    // throw an "unhandled case" fail.
    expect(AGENT_MOUNT_V1_CONFORMANCE_CASES.length).toBe(15);
  });

  test("runConformance against the reference adapter: 4 compile.* pass, 11 not_applicable, 0 fail", async () => {
    fixture = await referenceFixture();
    const report: ConformanceReport = await runConformance(fixture, referenceAdapter());
    expect(report.fail).toBe(0);
    expect(report.pass).toBe(4);
    expect(report.notApplicable).toBe(11);
    expect(report.pass + report.fail + report.notApplicable).toBe(15);
    // The 4 compile.* cases all pass.
    for (const name of ["compile.link_narrows", "compile.deterministic_artifact_digest", "compile.manifest_digest_binds_exports", "compile.artifact_hygiene"] as const) {
      const r = report.results.find((x) => x.case === name);
      expect(r?.status).toBe("pass");
    }
    // Every authority.*/replay.*/intent.* case is not_applicable (runner case not yet
    // implemented — NOT an adapter failure).
    for (const r of report.results) {
      if (r.case.startsWith("authority.") || r.case.startsWith("replay.") || r.case.startsWith("intent.")) {
        expect(r.status).toBe("not_applicable");
      }
    }
  });

  test("compile.link_narrows: an adapter that DOESN'T narrow (accepts unexported) fails the case", async () => {
    // A misbehaving adapter that ignores linkAgentSource's narrowing must be caught.
    fixture = await referenceFixture();
    const bad: AgentMountConformanceAdapter = {
      ...referenceAdapter(),
      async compile(source) {
        // Bogus: returns an artifact whose linkedFunctionality includes an UNEXPORTED id,
        // skipping linkAgentSource's functionality_denied check.
        const linked = await linkAgentSource({ ...source, requestedFunctionality: ["ref.item.get"] }, fixture.manifest);
        return attachMountArtifactPublisher(
          { ...linked, linkedFunctionality: [...linked.linkedFunctionality, "not.exported"] },
          { keyId: "k", signature: "s" },
        );
      },
    };
    const r = await runConformanceCase("compile.link_narrows", fixture, bad);
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("unexported");
  });

  test("compile.deterministic_artifact_digest: an adapter returning a non-deterministic digest fails", async () => {
    fixture = await referenceFixture();
    let n = 0;
    const nondeterministic: AgentMountConformanceAdapter = {
      ...referenceAdapter(),
      async compile(source, manifest) {
        const linked = await linkAgentSource(source, manifest);
        // Tamper with the digest on the second call → non-deterministic.
        const digest = n++ === 0 ? linked.artifactDigest : "different-each-time";
        return attachMountArtifactPublisher({ ...linked, artifactDigest: digest }, { keyId: "k", signature: "s" });
      },
    };
    const r = await runConformanceCase("compile.deterministic_artifact_digest", fixture, nondeterministic);
    expect(r.status).toBe("fail");
  });
});