import { describe, expect, test } from "bun:test";
import {
  AgentMountError,
  argumentBindingDigest,
  assertDomainArguments,
  assertFunctionalityDefinition,
  canonicalJson,
} from "../src/core.ts";

describe("core contract", () => {
  test("canonicalizes object keys and produces a stable digest", async () => {
    expect(canonicalJson({ z: 1, a: [true, "x"] })).toBe('{"a":[true,"x"],"z":1}');
    expect(await argumentBindingDigest({ b: 2, a: 1 })).toBe(await argumentBindingDigest({ a: 1, b: 2 }));
  });

  test("rejects authority smuggling in domain arguments", () => {
    expect(() => assertDomainArguments({ symbol: "ABC", mountId: "forged" })).toThrow(AgentMountError);
    expect(() => assertDomainArguments({ order: { principal_id: "forged" } })).toThrow(AgentMountError);
  });

  test("requires intent deadlines and L4 for irreversible effects", () => {
    expect(() => assertFunctionalityDefinition({
      id: "trade.execute", kind: "effect", title: "Trade", description: "Trade",
      inputSchema: {}, approvalMode: "environment", reversible: false,
      idempotencyRequired: true, minimumConformanceLevel: "L3",
    })).toThrow("requires intentResolutionDeadlineMs");
    expect(() => assertFunctionalityDefinition({
      id: "trade.execute", kind: "effect", title: "Trade", description: "Trade",
      inputSchema: {}, approvalMode: "environment", reversible: false,
      idempotencyRequired: true, intentResolutionDeadlineMs: 30_000, minimumConformanceLevel: "L3",
    })).toThrow("must require L4");
  });
});
