import { describe, expect, it } from "vitest";
import { defaultAllowed, validRolePermission } from "../routes/nurseryOperations";

describe("nursery operations default authorization", () => {
  const sensitiveCrudMatrix = [
    { role: "admin", resource: "expense", allowed: [true, true, true, true] },
    { role: "supervisor", resource: "expense", allowed: [true, true, true, true] },
    { role: "teacher", resource: "curriculum", allowed: [true, true, true, false] },
    { role: "accountant", resource: "expense", allowed: [true, true, true, false] },
    { role: "receptionist", resource: "branch", allowed: [true, false, false, false] },
    { role: "parent", resource: "expense", allowed: [false, false, false, false] },
  ] as const;

  it.each(sensitiveCrudMatrix)(
    "keeps the sensitive CRUD baseline stable for $role",
    ({ role, resource, allowed }) => {
      expect([
        defaultAllowed(role, `read:${resource}`),
        defaultAllowed(role, `write:${resource}`),
        defaultAllowed(role, `write:${resource}`),
        defaultAllowed(role, `delete:${resource}`),
      ]).toEqual(allowed);
    },
  );

  it("keeps administrative roles fully operational", () => {
    expect(defaultAllowed("owner", "read:permissions")).toBe(true);
    expect(defaultAllowed("admin", "write:payroll")).toBe(true);
    expect(defaultAllowed("nursery_admin", "delete:child-record")).toBe(true);
  });

  it("limits teachers to attendance and academic work", () => {
    expect(defaultAllowed("teacher", "read:curriculum")).toBe(true);
    expect(defaultAllowed("teacher", "write:assessment")).toBe(true);
    expect(defaultAllowed("teacher", "write:attendance")).toBe(true);
    expect(defaultAllowed("teacher", "read:child-confidential")).toBe(false);
    expect(defaultAllowed("teacher", "read:payroll")).toBe(false);
    expect(defaultAllowed("teacher", "read:report-financial")).toBe(false);
  });

  it("limits accounting and reception to their operational responsibilities", () => {
    expect(defaultAllowed("accountant", "read:expense")).toBe(true);
    expect(defaultAllowed("accountant", "write:refund")).toBe(true);
    expect(defaultAllowed("accountant", "read:child-record")).toBe(false);
    expect(defaultAllowed("receptionist", "read:child-record")).toBe(true);
    expect(defaultAllowed("receptionist", "write:attendance")).toBe(true);
    expect(defaultAllowed("receptionist", "read:child-confidential")).toBe(false);
  });

  it("denies unknown and parent roles on administrative endpoints", () => {
    expect(defaultAllowed("parent", "read:child-record")).toBe(false);
    expect(defaultAllowed("staff", "read:branch")).toBe(false);
    expect(defaultAllowed("unknown", "write:expense")).toBe(false);
  });

  it("rejects unknown roles and operations from configurable mutations", () => {
    expect(validRolePermission("teacher", "read:curriculum")).toBe(true);
    expect(validRolePermission("unknown", "read:curriculum")).toBe(false);
    expect(validRolePermission("teacher", "read:not-real")).toBe(false);
  });
});