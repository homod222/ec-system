import { asc, and, eq } from "drizzle-orm";
import { branchesTable, classroomsTable, db } from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Transaction;

export type BranchResolution =
  | { kind: "resolved"; branchId: number | null }
  | { kind: "missing" };

export async function defaultBranchId(exec: Executor, ownerId: string): Promise<number | null> {
  const [activeBranch] = await exec
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(
      eq(branchesTable.ownerId, ownerId),
      eq(branchesTable.active, true),
    ))
    .orderBy(asc(branchesTable.id))
    .limit(1);
  if (activeBranch) return activeBranch.id;

  const [branch] = await exec
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(eq(branchesTable.ownerId, ownerId))
    .orderBy(asc(branchesTable.id))
    .limit(1);
  return branch?.id ?? null;
}

export async function resolveBranchId(
  exec: Executor,
  ownerId: string,
  provided: number | null | undefined,
): Promise<BranchResolution> {
  if (provided == null) {
    return { kind: "resolved", branchId: await defaultBranchId(exec, ownerId) };
  }
  const [branch] = await exec
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(
      eq(branchesTable.id, provided),
      eq(branchesTable.ownerId, ownerId),
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
