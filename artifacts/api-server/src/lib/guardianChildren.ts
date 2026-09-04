import { and, eq, inArray, or } from "drizzle-orm";
import { childGuardianLinksTable, childrenTable, db } from "@workspace/db";

export function guardianChildCondition(guardianId: number, ownerId: string) {
  return or(
    eq(childrenTable.guardianId, guardianId),
    inArray(
      childrenTable.id,
      db.select({ id: childGuardianLinksTable.childId })
        .from(childGuardianLinksTable)
        .where(and(
          eq(childGuardianLinksTable.guardianId, guardianId),
          eq(childGuardianLinksTable.ownerId, ownerId),
        )),
    ),
  );
}
