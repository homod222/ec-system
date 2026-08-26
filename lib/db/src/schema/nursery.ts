import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const guardiansTable = pgTable("guardians", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  clerkUserId: text("clerk_user_id").unique(),
  balance: numeric("balance", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
});

export const classroomsTable = pgTable("classrooms", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__legacy__"),
  name: text("name").notNull(),
  level: text("level").notNull(),
  teacherName: text("teacher_name").notNull(),
  capacity: integer("capacity").notNull(),
  color: text("color").notNull().default("teal"),
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
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone").notNull(),
  status: text("status").notNull().default("present"),
  avatarUrl: text("avatar_url"),
});

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  childId: integer("child_id").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  checkIn: text("check_in"),
  checkOut: text("check_out"),
  note: text("note"),
});

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  guardianId: integer("guardian_id").notNull(),
  childId: integer("child_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2, mode: "number" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  lastPaymentStatus: text("last_payment_status"),
  lastPaymentError: text("last_payment_error"),
  // Invoices are denominated in KWD, but the connected Stripe account does not
  // support KWD as a presentment currency, so the actual card charge happens
  // in a supported currency (currently USD). These record what Stripe actually
  // charged, straight from the webhook payload, for audit/reconciliation.
  chargedCurrency: text("charged_currency"),
  chargedAmount: numeric("charged_amount", { precision: 10, scale: 2, mode: "number" }),
  exchangeRate: numeric("exchange_rate", { precision: 10, scale: 4, mode: "number" }),
});

export const paymentNotificationsTable = pgTable("payment_notifications", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  channel: text("channel").notNull().default("whatsapp"),
  type: text("type").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const uploadGrantsTable = pgTable("upload_grants", {
  id: serial("id").primaryKey(),
  objectPath: text("object_path").notNull().unique(),
  ownerId: text("owner_id").notNull(),
  applicationId: integer("application_id").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  status: text("status").notNull().default("issued"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export type Guardian = typeof guardiansTable.$inferSelect;
export type Classroom = typeof classroomsTable.$inferSelect;
export type Child = typeof childrenTable.$inferSelect;
export type StaffMember = typeof staffTable.$inferSelect;
export type Attendance = typeof attendanceTable.$inferSelect;
export type Invoice = typeof invoicesTable.$inferSelect;
export type Activity = typeof activitiesTable.$inferSelect;

export type ProgressReport = typeof progressReportsTable.$inferSelect;

export type PaymentNotification = typeof paymentNotificationsTable.$inferSelect;
export type Application = typeof applicationsTable.$inferSelect;
export type ApplicationDocument = typeof applicationDocumentsTable.$inferSelect;
export type UploadGrant = typeof uploadGrantsTable.$inferSelect;
export type InsertChild = z.infer<typeof insertChildSchema>;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type InsertApplication = z.infer<typeof insertApplicationSchema>;

export const childActivitiesTable = pgTable("child_activities", {
  id: serial("id").primaryKey(),
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
