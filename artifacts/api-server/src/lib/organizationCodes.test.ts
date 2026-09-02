import { describe, expect, it } from "vitest";
import {
  branchCode,
  CODE_PATTERN,
  derivePrefix,
  organizationCode,
  prefixOf,
  uniquePrefix,
} from "./organizationCodes";

describe("organization code helpers", () => {
  it("derives prefixes from Latin words", () => {
    expect(derivePrefix("مجموعة EC")).toBe("EC");
    expect(derivePrefix("Early Center Kids")).toBe("ECK");
    expect(derivePrefix("EC")).toBe("EC");
    expect(derivePrefix("Kindergarten")).toBe("KIN");
  });

  it("falls back to numbered organization prefixes for Arabic-only names", () => {
    expect(derivePrefix("مجموعة أطفال")).toBeNull();
    expect(uniquePrefix(null, new Set())).toBe("ORG1");
    expect(uniquePrefix(null, new Set(["ORG1"]))).toBe("ORG2");
  });

  it("avoids taken prefixes and reserves the organization suffix", () => {
    expect(uniquePrefix("EC", new Set(["EC"]))).toBe("EC2");
    expect(organizationCode("EC")).toBe("EC.000");
    expect(branchCode("EC", new Set([1, 2]))).toBe("EC.003");
  });

  it("normalizes prefixes and validates hierarchical codes", () => {
    expect(prefixOf("ec.001")).toBe("EC");
    expect(CODE_PATTERN.test("EC.000")).toBe(true);
    expect(CODE_PATTERN.test("BR-001")).toBe(false);
    expect(CODE_PATTERN.test("MAIN")).toBe(false);
  });
});
