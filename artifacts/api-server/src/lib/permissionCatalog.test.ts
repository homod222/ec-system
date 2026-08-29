import { describe, expect, it } from "vitest";
import {
  configurableOperations,
  configurableOperationSet,
  permissionCatalog,
} from "./permissionCatalog";

const operationalResources = [
  "branch", "stage", "teacher-assignment", "classroom-schedule", "staff-profile", "staff-job",
  "staff-leave", "payroll", "evaluation", "curriculum", "lesson-plan", "skill", "assessment",
  "progress-report", "event", "media", "fee-plan", "discount", "refund", "expense", "revenue",
  "setting", "holiday", "notification", "integration",
] as const;

const expectedOperations = [
  ...operationalResources.flatMap((resource) => [
    `read:${resource}`, `write:${resource}`, `delete:${resource}`,
  ]),
  "read:attendance", "write:attendance",
  "read:child-record", "read:child-confidential",
  "write:child-health", "write:child-emergency", "write:child-allergy", "write:child-medication",
  "write:child-document", "write:child-photo", "write:child-note", "write:child-history",
  "read:report-operational", "read:report-academic", "read:report-financial",
  "read:permissions", "read:audit",
  "read:dashboard", "read:children", "write:children", "delete:children",
  "read:invoice", "write:invoice", "write:payment",
  "read:application", "write:application", "accept:application", "write:application-document",
  "read:site-gallery", "create:site-gallery", "update:site-gallery",
  "publish:site-gallery", "delete:site-gallery", "reorder:site-gallery",
];

describe("permission catalog", () => {
  it("classifies every configurable operation exactly once without changing its string", () => {
    expect([...configurableOperations].sort()).toEqual([...expectedOperations].sort());
    expect(new Set(configurableOperations).size).toBe(configurableOperations.length);
    expect(permissionCatalog.every(({ module, page, operations }) =>
      Boolean(module) && Boolean(page) && operations.length > 0)).toBe(true);
  });

  it("keeps unknown operation strings outside the mutation whitelist", () => {
    expect(configurableOperationSet.has("read:branch")).toBe(true);
    expect(configurableOperationSet.has("read:unknown")).toBe(false);
    expect(configurableOperationSet.has("write:permissions")).toBe(false);
  });
});