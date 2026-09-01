import { eq } from "drizzle-orm";
import {
  db,
  nurserySettingsTable,
  publicAuthAccountsTable,
  staffTable,
  userPermissionsTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/localAuth";

const PHONE = "96560607740";
const EMAIL = "homod222@hotmail.com";
const FULL_NAME = "Homod Ali Alnomasi";
const PASSWORD = "REPLACE_WITH_15_CHAR_PASSWORD";
const STAFF_ID = 638;

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  const [account] = await db.insert(publicAuthAccountsTable).values({
    normalizedPhone: PHONE,
    fullName: FULL_NAME,
    email: EMAIL,
    accountType: "staff",
    accountStatus: "active",
    passwordHash,
    role: "owner",
    staffId: STAFF_ID,
  }).onConflictDoNothing().returning();

  if (!account) {
    console.log("Account already exists for this phone/email.");
    return;
  }

  const ownerId = String(account.id);
  const accountRef = `local_${account.id}`;

  await db.update(publicAuthAccountsTable).set({
    ownerId,
  }).where(eq(publicAuthAccountsTable.id, account.id));

  await db.update(nurserySettingsTable).set({
    ownerId,
    updatedBy: ownerId,
  });

  await db.update(staffTable).set({
    clerkUserId: accountRef,
    accountStatus: "active",
    role: "owner",
    status: "present",
  }).where(eq(staffTable.id, STAFF_ID));

  await db.insert(userPermissionsTable).values({
    ownerId,
    userId: ownerId,
    operation: "*",
    allowed: true,
  }).onConflictDoUpdate({
    target: [userPermissionsTable.ownerId, userPermissionsTable.userId, userPermissionsTable.operation],
    set: { allowed: true },
  });

  console.log("Bootstrapped owner:", ownerId, "(account ID:", account.id, ")");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
