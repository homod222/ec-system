import { and, count, eq, ne, sql } from "drizzle-orm";
import { childrenTable, classroomsTable, db } from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ClassroomCapacityResult =
  | { kind: "available" }
  | { kind: "missing" }
  | { kind: "full" };

export async function checkClassroomCapacity(
  tx: Transaction,
  ownerId: string,
  classroomId: number,
  excludeChildId?: number,
): Promise<ClassroomCapacityResult> {
  await tx.execute(sql`
    select id
    from classrooms
    where id = ${classroomId} and owner_id = ${ownerId}
    for update
  `);
  const [classroom] = await tx
    .select({ capacity: classroomsTable.capacity })
    .from(classroomsTable)
    .where(and(
      eq(classroomsTable.id, classroomId),
      eq(classroomsTable.ownerId, ownerId),
    ));
  if (!classroom) return { kind: "missing" };

  const [occupancy] = await tx
    .select({ value: count() })
    .from(childrenTable)
    .where(and(
      eq(childrenTable.ownerId, ownerId),
      eq(childrenTable.classroomId, classroomId),
      eq(childrenTable.status, "active"),
      excludeChildId === undefined ? undefined : ne(childrenTable.id, excludeChildId),
    ));
  return occupancy.value >= classroom.capacity ? { kind: "full" } : { kind: "available" };
}