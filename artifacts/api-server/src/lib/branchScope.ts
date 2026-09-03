import { asc, and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { branchesTable, classroomsTable, db, staffScopeAssignmentsTable } from "@workspace/db";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Transaction;

export type BranchResolution =
  | { kind: "resolved"; branchId: number | null }
  | { kind: "missing" };

export type BranchScope = number[] | null;

export const FULL_ACCESS_ROLES = new Set(["owner", "superadmin", "admin", "nursery_admin"]);

export function defaultScopedBranchId(
  scope: BranchScope,
  provided: number | null | undefined,
):
  | { kind: "ok"; branchId: number | null }
  | { kind: "forbidden" }
  | { kind: "ambiguous" } {
  if (scope === null) return { kind: "ok", branchId: provided ?? null };
  if (provided != null) {
    return scope.includes(provided)
      ? { kind: "ok", branchId: provided }
      : { kind: "forbidden" };
  }
  if (scope.length === 1) return { kind: "ok", branchId: scope[0] };
  if (scope.length === 0) return { kind: "forbidden" };
  return { kind: "ambiguous" };
}

export function branchCondition(column: AnyPgColumn, scope: BranchScope): SQL | undefined {
  if (scope === null) return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(column, scope);
}

export async function defaultBranchId(
  exec: Executor,
  ownerId: string,
  scope: BranchScope = null,
): Promise<number | null> {
  const [activeBranch] = await exec
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(
      eq(branchesTable.ownerId, ownerId),
      eq(branchesTable.active, true),
      branchCondition(branchesTable.id, scope),
    ))
    .orderBy(asc(branchesTable.id))
    .limit(1);
  if (activeBranch) return activeBranch.id;

  const [branch] = await exec
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(
      eq(branchesTable.ownerId, ownerId),
      branchCondition(branchesTable.id, scope),
    ))
    .orderBy(asc(branchesTable.id))
    .limit(1);
  return branch?.id ?? null;
}

export async function resolveBranchId(
  exec: Executor,
  ownerId: string,
  provided: number | null | undefined,
  scope: BranchScope = null,
): Promise<BranchResolution> {
  if (provided == null) {
    return { kind: "resolved", branchId: await defaultBranchId(exec, ownerId, scope) };
  }
  if (scope !== null && !scope.includes(provided)) return { kind: "missing" };
  const [branch] = await exec
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(
      eq(branchesTable.id, provided),
      eq(branchesTable.ownerId, ownerId),
      branchCondition(branchesTable.id, scope),
    ))
    .limit(1);
  return branch ? { kind: "resolved", branchId: branch.id } : { kind: "missing" };
}

export async function classroomBranchMismatch(
  exec: Executor,
  ownerId: string,
  classroomId: number,
  branchId: number | null,
): Promise<boolean> {
  const [classroom] = await exec
    .select({ branchId: classroomsTable.branchId })
    .from(classroomsTable)
    .where(and(
      eq(classroomsTable.id, classroomId),
      eq(classroomsTable.ownerId, ownerId),
    ))
    .limit(1);
  return classroom?.branchId != null && classroom.branchId !== branchId;
}

export async function resolveStaffScope(
  exec: Executor,
  ownerId: string,
  staff: { id: number; branchId: number | null; role: string },
): Promise<BranchScope> {
  if (FULL_ACCESS_ROLES.has(staff.role.toLowerCase())) return null;
  const assignments = await exec
    .select({
      organizationId: staffScopeAssignmentsTable.organizationId,
      branchId: staffScopeAssignmentsTable.branchId,
    })
    .from(staffScopeAssignmentsTable)
    .where(and(
      eq(staffScopeAssignmentsTable.ownerId, ownerId),
      eq(staffScopeAssignmentsTable.staffId, staff.id),
    ));
  const branchIds = new Set<number>();
  const organizationIds: number[] = [];
  for (const assignment of assignments) {
    if (assignment.branchId != null) branchIds.add(assignment.branchId);
    if (assignment.organizationId != null) organizationIds.push(assignment.organizationId);
  }
  if (organizationIds.length > 0) {
    const branches = await exec
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(and(
        eq(branchesTable.ownerId, ownerId),
        inArray(branchesTable.organizationId, organizationIds),
      ));
    for (const branch of branches) branchIds.add(branch.id);
  }
  if (branchIds.size > 0 || assignments.length > 0) return [...branchIds].sort((a, b) => a - b);
  return staff.branchId != null ? [staff.branchId] : [];
}
