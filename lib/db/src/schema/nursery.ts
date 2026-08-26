import {
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
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  balance: numeric("balance", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
});

export const classroomsTable = pgTable("classrooms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  level: text("level").notNull(),
  teacherName: text("teacher_name").notNull(),
  capacity: integer("capacity").notNull(),
  color: text("color").notNull().default("teal"),
});

export const childrenTable = pgTable("children", {
  id: serial("id").primaryKey(),
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
});

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGuardianSchema = createInsertSchema(guardiansTable).omit({ id: true });
export const insertClassroomSchema = createInsertSchema(classroomsTable).omit({ id: true });
export const insertChildSchema = createInsertSchema(childrenTable).omit({ id: true, createdAt: true });
export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true });
export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true });
export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true });
export const insertActivitySchema = createInsertSchema(activitiesTable).omit({ id: true, createdAt: true });

export type Guardian = typeof guardiansTable.$inferSelect;
export type Classroom = typeof classroomsTable.$inferSelect;
export type Child = typeof childrenTable.$inferSelect;
export type StaffMember = typeof staffTable.$inferSelect;
export type Attendance = typeof attendanceTable.$inferSelect;
export type Invoice = typeof invoicesTable.$inferSelect;
export type Activity = typeof activitiesTable.$inferSelect;
export type InsertChild = z.infer<typeof insertChildSchema>;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;