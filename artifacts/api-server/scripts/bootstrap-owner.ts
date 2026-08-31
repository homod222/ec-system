import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  nurserySettingsTable,
  publicAuthAccountsTable,
  staffTable,
  userPermissionsTable,
} from "@workspace/db";

const PHONE = "96560607740";
const EMAIL = "homod222@hotmail.com";
const FULL_NAME = "Homod Ali Alnomasi";
const PASSWORD = "homod123456789&";
const STAFF_ID = 638;

async function main() {
  const names = FULL_NAME.split(/\\s+/u);

  const clerkUser = await clerkClient.users.createUser({
    emailAddress: [EMAIL],
    password: PASSWORD,
    firstName: names[0],
    lastName: names.slice(1).join(" "),
    publicMetadata: { role: "owner", accountStatus: "active" },
    privateMetadata: { staffId: STAFF_ID },
  });

  const clerkUserId = clerkUser.id;

  await db.update(nurserySettingsTable).set({
    ownerId: clerkUserId,
    updatedBy: clerkUserId,
  });

  await db.update(staffTable).set({
    clerkUserId,
    accountStatus: "active",
    role: "owner",
    status: "present",
  }).where(eq(staffTable.id, STAFF_ID));

  await db.insert(publicAuthAccountsTable).values({
    normalizedPhone: PHONE,
    clerkUserId,
    fullName: FULL_NAME,
    email: EMAIL,
    accountType: "staff",
    accountStatus: "active",
    ownerId: clerkUserId,
    staffId: STAFF_ID,
  }).onConflictDoNothing();

  await db.insert(userPermissionsTable).values({
    ownerId: clerkUserId,
    userId: clerkUserId,
    operation: "*",
    allowed: true,
  }).onConflictDoUpdate({
    target: [userPermissionsTable.ownerId, userPermissionsTable.userId, userPermissionsTable.operation],
    set: { allowed: true },
  });

  console.log("Bootstrapped owner:", clerkUserId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
