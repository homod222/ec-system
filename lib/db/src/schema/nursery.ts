import {
  boolean,
  date,
  integer,
  numeric,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const guardiansTable = pgTable("guardians", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  clerkUserId: text("clerk_user_id"),
  /** Lower-cased trimmed email, or phone when email is unavailable; unique per owner. */
  identityKey: text("identity_key"),
  balance: numeric("balance", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
}, (table) => [
  uniqueIndex("guardians_clerk_user_id_unique").on(table.clerkUserId),
  uniqueIndex("guardians_owner_identity_key_unique")
    .on(table.ownerId, table.identityKey)
    .where(sql`${table.identityKey} is not null`),
]);

/** Verified owner/admin phone aliases. Login remains bound to the existing Clerk user. */
export const phoneLoginIdentitiesTable = pgTable("phone_login_identities", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  normalizedPhone: text("normalized_phone").notNull(),
  firstName: text("first_name").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("phone_login_identities_clerk_user_id_key").on(table.clerkUserId),
  uniqueIndex("phone_login_identities_normalized_phone_key").on(table.normalizedPhone),
]);

/** Durable, hashed, single-use challenges for login and authenticated enrollment. */
export const phoneOtpChallengesTable = pgTable("phone_otp_challenges", {
  id: text("id").primaryKey(),
  purpose: text("purpose").notNull(),
  normalizedPhoneHash: text("normalized_phone_hash").notNull(),
  normalizedPhone: text("normalized_phone"),
  ipHash: text("ip_hash").notNull(),
  otpHash: text("otp_hash").notNull(),
  clerkUserId: text("clerk_user_id"),
  firstName: text("first_name"),
  fullName: text("full_name"),
  email: text("email"),
  accountType: text("account_type"),
  requestedBy: text("requested_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Public password accounts. Password material remains exclusively in Clerk. */
export const publicAuthAccountsTable = pgTable("public_auth_accounts", {
  id: serial("id").primaryKey(),
  normalizedPhone: text("normalized_phone").notNull(),
  clerkUserId: text("clerk_user_id").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  accountType: text("account_type").notNull(),
  accountStatus: text("account_status").notNull().default("pending"),
  ownerId: text("owner_id"),
  guardianId: integer("guardian_id"),
  staffId: integer("staff_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("public_auth_accounts_normalized_phone_key").on(table.normalizedPhone),
  uniqueIndex("public_auth_accounts_clerk_user_id_key").on(table.clerkUserId),
  uniqueIndex("public_auth_accounts_email_unique").on(sql`lower(${table.email})`),
]);

export const classroomsTable = pgTable("classrooms", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  name: text("name").notNull(),
  level: text("level").notNull(),
  teacherName: text("teacher_name").notNull(),
  capacity: integer("capacity").notNull(),
  color: text("color").notNull().default("teal"),
  branchId: integer("branch_id"),
  stageId: integer("stage_id"),
  schedule: jsonb("schedule").$type<Record<string, unknown>>().notNull().default({}),
});

export const childrenTable = pgTable("children", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  gender: text("gender").notNull(),
  birthDate: date("birth_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
  classroomId: integer("classroom_id"),
  guardianId: integer("guardian_id").notNull(),
  level: text("level").notNull(),
  avatarUrl: text("avatar_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffTable = pgTable("staff", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  branchId: integer("branch_id"),
  name: text("name").notNull(),
  role: text("role").notNull(),
  jobTitle: text("job_title"),
  email: text("email"),
  phone: text("phone").notNull(),
  hireDate: date("hire_date", { mode: "string" }),
  salary: numeric("salary", { precision: 12, scale: 2, mode: "number" }),
  status: text("status").notNull().default("present"),
  avatarUrl: text("avatar_url"),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  clerkUserId: text("clerk_user_id"),
  accountStatus: text("account_status").notNull().default("unlinked"),
  otpHash: text("otp_hash"),
  otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
  otpAttempts: integer("otp_attempts").notNull().default(0),
  passwordResetHash: text("password_reset_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
  passwordResetRequestedAt: timestamp("password_reset_requested_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("staff_clerk_user_id_unique").on(table.clerkUserId),
]);

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  childId: integer("child_id").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  checkIn: text("check_in"),
  checkOut: text("check_out"),
  departureType: text("departure_type"),
  source: text("source").notNull().default("manual"),
  recordedBy: text("recorded_by"),
  note: text("note"),
  pickupName: text("pickup_name"),
  pickupIdentity: text("pickup_identity"),
  correctedAt: timestamp("corrected_at", { withTimezone: true }),
  correctionReason: text("correction_reason"),
});

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  invoiceNumber: text("invoice_number").notNull(),
  guardianId: integer("guardian_id").notNull(),
  childId: integer("child_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripeCheckoutAttempt: integer("stripe_checkout_attempt").notNull().default(0),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  myFatoorahInvoiceId: text("myfatoorah_invoice_id"),
  myFatoorahPaymentId: text("myfatoorah_payment_id"),
  myFatoorahPaymentUrl: text("myfatoorah_payment_url"),
  myFatoorahCheckoutAttempt: integer("myfatoorah_checkout_attempt").notNull().default(0),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  lastPaymentStatus: text("last_payment_status"),
  lastPaymentError: text("last_payment_error"),
  // Records the actual provider charge for audit/reconciliation. New KNET
  // payments are always charged in KWD; legacy Stripe rows may retain USD.
  chargedCurrency: text("charged_currency"),
  chargedAmount: numeric("charged_amount", { precision: 12, scale: 3, mode: "number" }),
  exchangeRate: numeric("exchange_rate", { precision: 10, scale: 4, mode: "number" }),
  paymentMethod: text("payment_method"),
  paymentReference: text("payment_reference"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  billingPlanId: integer("billing_plan_id"),
  installmentId: integer("installment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoicePaymentsTable = pgTable("invoice_payments", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  method: text("method").notNull(),
  amount: numeric("amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  currency: text("currency").notNull().default("KWD"),
  status: text("status").notNull(),
  reference: text("reference"),
  note: text("note"),
  recordedBy: text("recorded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentAttemptsTable = pgTable("payment_attempts", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  customerReference: text("customer_reference").notNull(),
  providerInvoiceId: text("provider_invoice_id"),
  providerPaymentId: text("provider_payment_id"),
  paymentUrl: text("payment_url"),
  status: text("status").notNull(),
  amount: numeric("amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  currency: text("currency").notNull().default("KWD"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("payment_attempts_customer_reference_key").on(table.customerReference),
  uniqueIndex("payment_attempts_provider_invoice_id_key").on(table.providerInvoiceId),
  uniqueIndex("payment_attempts_invoice_attempt_unique").on(table.invoiceId, table.attemptNumber),
]);
export const exchangeRatesTable = pgTable("exchange_rates", {
  pair: text("pair").primaryKey(),
  rate: numeric("rate", { precision: 12, scale: 6, mode: "number" }).notNull(),
  source: text("source").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
export const paymentNotificationsTable = pgTable("payment_notifications", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  channel: text("channel").notNull().default("whatsapp"),
  type: text("type").notNull(),
  source: text("source").notNull().default("manual"),
  reminderStage: text("reminder_stage"),
  recipientPhone: text("recipient_phone").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationDispatchClaimsTable = pgTable("notification_dispatch_claims", {
  id: serial("id").primaryKey(),
  deduplicationKey: text("deduplication_key").notNull().unique(),
  invoiceId: integer("invoice_id").notNull(),
  reminderStage: text("reminder_stage").notNull(),
  status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const progressReportsTable = pgTable("progress_reports", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  childId: integer("child_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  period: text("period").notNull(),
  educatorName: text("educator_name").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});
export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  type: text("type").notNull().default("new"),
  status: text("status").notNull().default("new"),
  childId: integer("child_id"),
  sourceChildId: integer("source_child_id"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  gender: text("gender").notNull(),
  birthDate: date("birth_date", { mode: "string" }).notNull(),
  level: text("level").notNull(),
  classroomId: integer("classroom_id"),
  notes: text("notes"),
  guardianName: text("guardian_name").notNull(),
  guardianPhone: text("guardian_phone").notNull(),
  guardianEmail: text("guardian_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const applicationDocumentsTable = pgTable("application_documents", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull(),
  childId: integer("child_id"),
  parentVisible: boolean("parent_visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const uploadGrantsTable = pgTable("upload_grants", {
  id: serial("id").primaryKey(),
  objectPath: text("object_path").notNull().unique(),
  ownerId: text("owner_id").notNull(),
  applicationId: integer("application_id"),
  targetType: text("target_type").notNull().default("application-document"),
  targetId: integer("target_id"),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  status: text("status").notNull().default("issued"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siteGalleryItemsTable = pgTable("site_gallery_items", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  altText: text("alt_text").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("site_gallery_items_object_path_key").on(table.objectPath),
]);

export const insertGuardianSchema = createInsertSchema(guardiansTable).omit({ id: true, ownerId: true });
export const insertClassroomSchema = createInsertSchema(classroomsTable).omit({ id: true, ownerId: true });
export const insertChildSchema = createInsertSchema(childrenTable).omit({ id: true, ownerId: true, createdAt: true });
export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true });
export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true });
export const insertActivitySchema = createInsertSchema(activitiesTable).omit({ id: true, ownerId: true, createdAt: true });

export const insertProgressReportSchema = createInsertSchema(progressReportsTable).omit({ id: true, publishedAt: true });

export const insertPaymentNotificationSchema = createInsertSchema(paymentNotificationsTable).omit({ id: true, createdAt: true });
export const insertApplicationSchema = createInsertSchema(applicationsTable).omit({ id: true, ownerId: true, createdAt: true, updatedAt: true });
export const insertApplicationDocumentSchema = createInsertSchema(applicationDocumentsTable).omit({ id: true, createdAt: true });
export const insertUploadGrantSchema = createInsertSchema(uploadGrantsTable).omit({ id: true, createdAt: true, consumedAt: true });
export const insertSiteGalleryItemSchema = createInsertSchema(siteGalleryItemsTable).omit({ id: true, ownerId: true, createdBy: true, createdAt: true, updatedAt: true });

export type Guardian = typeof guardiansTable.$inferSelect;
export type Classroom = typeof classroomsTable.$inferSelect;
export type Child = typeof childrenTable.$inferSelect;
export type StaffMember = typeof staffTable.$inferSelect;
export type Attendance = typeof attendanceTable.$inferSelect;
export type Invoice = typeof invoicesTable.$inferSelect;

export type PaymentAttempt = typeof paymentAttemptsTable.$inferSelect;
export type Activity = typeof activitiesTable.$inferSelect;

export type ProgressReport = typeof progressReportsTable.$inferSelect;

export type PaymentNotification = typeof paymentNotificationsTable.$inferSelect;
export type Application = typeof applicationsTable.$inferSelect;
export type ApplicationDocument = typeof applicationDocumentsTable.$inferSelect;
export type UploadGrant = typeof uploadGrantsTable.$inferSelect;
export type SiteGalleryItem = typeof siteGalleryItemsTable.$inferSelect;
export type InsertChild = z.infer<typeof insertChildSchema>;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type InsertApplication = z.infer<typeof insertApplicationSchema>;

export const childActivitiesTable = pgTable("child_activities", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  childId: integer("child_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  photoUrl: text("photo_url"),
  educatorName: text("educator_name").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChildActivitySchema = createInsertSchema(childActivitiesTable).omit({ id: true, occurredAt: true });

export const parentMessagesTable = pgTable("parent_messages", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  guardianId: integer("guardian_id").notNull(),
  senderType: text("sender_type").notNull(),
  senderName: text("sender_name").notNull(),
  subject: text("subject").notNull(),
  content: text("content").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  audience: text("audience").notNull().default("all"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChildActivity = typeof childActivitiesTable.$inferSelect;
export type Announcement = typeof announcementsTable.$inferSelect;
export type ParentMessage = typeof parentMessagesTable.$inferSelect;

export const insertParentMessageSchema = createInsertSchema(parentMessagesTable).omit({ id: true, createdAt: true });
export const insertAnnouncementSchema = createInsertSchema(announcementsTable).omit({ id: true, ownerId: true, publishedAt: true });

export const branchesTable = pgTable("nursery_branches", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  address: text("address"),
  phone: text("phone"),
  capacity: integer("capacity").notNull().default(0),
  active: boolean("active").notNull().default(true),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stagesTable = pgTable("nursery_stages", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  branchId: integer("branch_id"),
  name: text("name").notNull(),
  minAgeMonths: integer("min_age_months"),
  maxAgeMonths: integer("max_age_months"),
  capacity: integer("capacity").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffAttendanceTable = pgTable("staff_attendance", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  staffId: integer("staff_id").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  checkIn: text("check_in"),
  checkOut: text("check_out"),
  departureType: text("departure_type"),
  source: text("source").notNull().default("manual"),
  note: text("note"),
  recordedBy: text("recorded_by").notNull(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role"),
  operation: text("operation").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBranchSchema = createInsertSchema(branchesTable).omit({ id: true, ownerId: true, createdAt: true });

/** Detailed, category-addressable child dossier entries. File rows store private object paths only. */
export const childRecordsTable = pgTable("child_records", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  childId: integer("child_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  occurredOn: date("occurred_on", { mode: "string" }),
  confidential: boolean("confidential").notNull().default(false),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Branch = typeof branchesTable.$inferSelect;

export type ChildRecord = typeof childRecordsTable.$inferSelect;

export type StaffAttendance = typeof staffAttendanceTable.$inferSelect;

export type OperationalRecord = typeof operationalRecordsTable.$inferSelect;

export const insertChildRecordSchema = createInsertSchema(childRecordsTable).omit({ id: true, ownerId: true, createdBy: true, createdAt: true, updatedAt: true });

export const rolePermissionsTable = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  role: text("role").notNull(),
  operation: text("operation").notNull(),
  allowed: boolean("allowed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export const userPermissionsTable = pgTable("user_permissions", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  userId: text("user_id").notNull(),
  operation: text("operation").notNull(),
  allowed: boolean("allowed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("user_permissions_owner_user_operation_unique").on(table.ownerId, table.userId, table.operation)]);

export const insertRolePermissionSchema = createInsertSchema(rolePermissionsTable).omit({ id: true, ownerId: true, updatedAt: true });

export const insertStaffAttendanceSchema = createInsertSchema(staffAttendanceTable).omit({ id: true, ownerId: true, recordedBy: true });

export type AuditLog = typeof auditLogsTable.$inferSelect;

export const insertStageSchema = createInsertSchema(stagesTable).omit({ id: true, ownerId: true, createdAt: true });

export type RolePermission = typeof rolePermissionsTable.$inferSelect;
export type UserPermission = typeof userPermissionsTable.$inferSelect;

export type Stage = typeof stagesTable.$inferSelect;

/**
 * Typed operational ledger. Resource is constrained by the API contract and
 * covers HR, academic, finance and administration workflows while retaining
 * queryable ownership, dates, status, branch and subject relations.
 */
export const operationalRecordsTable = pgTable("operational_records", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  resource: text("resource").notNull(),
  subjectId: integer("subject_id"),
  branchId: integer("branch_id"),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  occurredOn: date("occurred_on", { mode: "string" }),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOperationalRecordSchema = createInsertSchema(operationalRecordsTable).omit({ id: true, ownerId: true, createdBy: true, createdAt: true, updatedAt: true });

/** Owner-scoped family, emergency, pickup, consent and account invitation dossier rows. */
export const childContactsTable = pgTable("child_contacts", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  childId: integer("child_id").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  relationship: text("relationship"),
  phone: text("phone"),
  email: text("email"),
  identityNumber: text("identity_number"),
  status: text("status").notNull().default("active"),
  primary: boolean("primary").notNull().default(false),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const invoiceLinesTable = pgTable("invoice_lines", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  type: text("type").notNull().default("fee"),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3, mode: "number" }).notNull().default(1),
  unitAmount: numeric("unit_amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
});

export const invoiceRefundsTable = pgTable("invoice_refunds", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  paymentId: integer("payment_id"),
  amount: numeric("amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceReceiptsTable = pgTable("invoice_receipts", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  paymentId: integer("payment_id").notNull(),
  receiptNumber: text("receipt_number").notNull(),
  amount: numeric("amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  issuedBy: text("issued_by").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nurserySettingsTable = pgTable("nursery_settings", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  nurseryName: text("nursery_name").notNull(),
  registrationWhatsApp: text("registration_whatsapp").notNull().default("96590916677"),
  timezone: text("timezone").notNull().default("Asia/Kuwait"),
  currency: text("currency").notNull().default("KWD"),
  workingHours: jsonb("working_hours").$type<Record<string, unknown>>().notNull().default({}),
  calendar: jsonb("calendar").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const billingPlansTable = pgTable("billing_plans", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  childId: integer("child_id").notNull(),
  guardianId: integer("guardian_id").notNull(),
  title: text("title").notNull(),
  cadence: text("cadence").notNull(),
  totalAmount: numeric("total_amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
  netAmount: numeric("net_amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  installmentCount: integer("installment_count").notNull(),
  issueLeadDays: integer("issue_lead_days").notNull().default(7),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const billingInstallmentsTable = pgTable("billing_installments", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  planId: integer("plan_id").notNull(),
  sequence: integer("sequence").notNull(),
  amount: numeric("amount", { precision: 12, scale: 3, mode: "number" }).notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("scheduled"),
  invoiceId: integer("invoice_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("billing_installments_plan_sequence_unique").on(table.planId, table.sequence),
  uniqueIndex("billing_installments_invoice_unique").on(table.invoiceId),
]);

export type ChildContact = typeof childContactsTable.$inferSelect;
export type InvoiceLine = typeof invoiceLinesTable.$inferSelect;
export type InvoiceRefund = typeof invoiceRefundsTable.$inferSelect;
export type InvoiceReceipt = typeof invoiceReceiptsTable.$inferSelect;
export type NurserySettings = typeof nurserySettingsTable.$inferSelect;
export type BillingPlan = typeof billingPlansTable.$inferSelect;
export type BillingInstallment = typeof billingInstallmentsTable.$inferSelect;
