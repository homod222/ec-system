import { Router, type IRouter, type RequestHandler } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  CreateChildBody,
  CreateChildResponse,
  DeleteChildParams,
  GetChildParams,
  GetChildResponse,
  GetDashboardActivityResponse,
  GetDashboardSummaryResponse,
  GetFinanceSummaryResponse,
  GetTodayAttendanceResponse,
  ListChildrenQueryParams,
  ListChildrenResponse,
  ListClassroomsResponse,
  ListGuardiansResponse,
  ListInvoicesQueryParams,
  ListInvoicesResponse,
  ListStaffResponse,
  RecordAttendanceBody,
  RecordAttendanceResponse,
  UpdateChildBody,
  UpdateChildParams,
  UpdateChildResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  attendanceTable,
  childrenTable,
  classroomsTable,
  db,
  guardiansTable,
  invoicesTable,
  staffTable,
} from "@workspace/db";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);

const requireAuth: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

async function childRows() {
  const [children, guardians, classrooms, attendance] = await Promise.all([
    db.select().from(childrenTable),
    db.select().from(guardiansTable),
    db.select().from(classroomsTable),
    db.select().from(attendanceTable),
  ]);
  const guardianMap = new Map(guardians.map((guardian) => [guardian.id, guardian]));
  const classroomMap = new Map(classrooms.map((classroom) => [classroom.id, classroom]));
  const attendanceMap = new Map<number, { total: number; present: number }>();
  attendance.forEach((record) => {
    const current = attendanceMap.get(record.childId) ?? { total: 0, present: 0 };
    current.total += 1;
    if (record.status === "present" || record.status === "late") current.present += 1;
    attendanceMap.set(record.childId, current);
  });
  return children.map((child) => {
    const guardian = guardianMap.get(child.guardianId);
    const classroom = child.classroomId ? classroomMap.get(child.classroomId) : undefined;
    const attendanceStats = attendanceMap.get(child.id);
    return {
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      fullName: `${child.firstName} ${child.lastName}`,
      gender: child.gender,
      birthDate: child.birthDate,
      status: child.status,
      classroomId: child.classroomId,
      classroomName: classroom?.name ?? null,
      guardianName: guardian?.name ?? "ولي أمر غير مسجل",
      guardianPhone: guardian?.phone ?? "",
      level: child.level,
      attendanceRate: attendanceStats ? Math.round((attendanceStats.present / attendanceStats.total) * 100) : 0,
      avatarUrl: child.avatarUrl,
      notes: child.notes,
    };
  });
}

router.use(requireAuth);

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const [children, attendance, staff, invoices] = await Promise.all([
    db.select().from(childrenTable),
    db.select().from(attendanceTable).where(eq(attendanceTable.date, today())),
    db.select().from(staffTable),
    db.select().from(invoicesTable),
  ]);
  const presentToday = attendance.filter((entry) => entry.status === "present" || entry.status === "late").length;
  const absentToday = attendance.filter((entry) => entry.status === "absent").length;
  const monthlyRevenue = invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const pendingPayments = invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const data = GetDashboardSummaryResponse.parse({
    totalChildren: children.filter((child) => child.status === "active").length,
    presentToday,
    absentToday,
    staffCount: staff.length,
    monthlyRevenue,
    pendingPayments,
    attendanceRate: children.length ? Math.round((presentToday / children.length) * 100) : 0,
  });
  req.log.info("Returned dashboard summary");
  res.json(data);
});

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  const activities = await db.select().from(activitiesTable).orderBy(desc(activitiesTable.createdAt)).limit(8);
  res.json(GetDashboardActivityResponse.parse(activities.map((entry) => ({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
  }))));
});

router.get("/children", async (req, res): Promise<void> => {
  const parsed = ListChildrenQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search?.trim().toLowerCase();
  const rows = (await childRows()).filter((child) => {
    const matchesSearch = !search || `${child.fullName} ${child.guardianName}`.toLowerCase().includes(search);
    const matchesClassroom = !parsed.data.classroomId || child.classroomId === parsed.data.classroomId;
    return matchesSearch && matchesClassroom;
  });
  res.json(ListChildrenResponse.parse(rows));
});

router.post("/children", async (req, res): Promise<void> => {
  const parsed = CreateChildBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const [guardian] = await db.insert(guardiansTable).values({
    name: input.guardianName,
    phone: input.guardianPhone,
    email: null,
    balance: 0,
  }).returning();
  const [child] = await db.insert(childrenTable).values({
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender,
    birthDate: input.birthDate,
    classroomId: input.classroomId ?? null,
    guardianId: guardian.id,
    level: input.level,
    notes: input.notes ?? null,
  }).returning();
  const record = (await childRows()).find((row) => row.id === child.id);
  res.status(201).json(CreateChildResponse.parse(record));
});

router.get("/children/:id", async (req, res): Promise<void> => {
  const parsed = GetChildParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const record = (await childRows()).find((row) => row.id === parsed.data.id);
  if (!record) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  res.json(GetChildResponse.parse(record));
});

router.patch("/children/:id", async (req, res): Promise<void> => {
  const params = UpdateChildParams.safeParse(req.params);
  const body = UpdateChildBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [current] = await db.select().from(childrenTable).where(eq(childrenTable.id, params.data.id));
  if (!current) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  let guardianId = current.guardianId;
  if (body.data.guardianName !== undefined || body.data.guardianPhone !== undefined) {
    await db.update(guardiansTable).set({
      ...(body.data.guardianName !== undefined ? { name: body.data.guardianName } : {}),
      ...(body.data.guardianPhone !== undefined ? { phone: body.data.guardianPhone } : {}),
    }).where(eq(guardiansTable.id, guardianId));
  }
  await db.update(childrenTable).set({
    ...(body.data.firstName !== undefined ? { firstName: body.data.firstName } : {}),
    ...(body.data.lastName !== undefined ? { lastName: body.data.lastName } : {}),
    ...(body.data.gender !== undefined ? { gender: body.data.gender } : {}),
    ...(body.data.birthDate !== undefined ? { birthDate: body.data.birthDate } : {}),
    ...(body.data.classroomId !== undefined ? { classroomId: body.data.classroomId } : {}),
    ...(body.data.level !== undefined ? { level: body.data.level } : {}),
    ...(body.data.status !== undefined ? { status: body.data.status } : {}),
    ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
  }).where(eq(childrenTable.id, params.data.id));
  const record = (await childRows()).find((row) => row.id === params.data.id);
  res.json(UpdateChildResponse.parse(record));
});

router.delete("/children/:id", async (req, res): Promise<void> => {
  const parsed = DeleteChildParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [deleted] = await db.delete(childrenTable).where(eq(childrenTable.id, parsed.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/guardians", async (_req, res): Promise<void> => {
  const [guardians, children] = await Promise.all([db.select().from(guardiansTable), db.select().from(childrenTable)]);
  res.json(ListGuardiansResponse.parse(guardians.map((guardian) => ({
    id: guardian.id,
    name: guardian.name,
    phone: guardian.phone,
    email: guardian.email,
    childrenCount: children.filter((child) => child.guardianId === guardian.id).length,
    balance: guardian.balance,
  }))));
});

router.get("/classrooms", async (_req, res): Promise<void> => {
  const [classrooms, children] = await Promise.all([db.select().from(classroomsTable), db.select().from(childrenTable)]);
  res.json(ListClassroomsResponse.parse(classrooms.map((classroom) => ({
    ...classroom,
    childrenCount: children.filter((child) => child.classroomId === classroom.id).length,
  }))));
});

router.get("/staff", async (_req, res): Promise<void> => {
  const staff = await db.select().from(staffTable);
  res.json(ListStaffResponse.parse(staff.map((member) => ({
    ...member,
    attendanceRate: member.status === "present" ? 100 : member.status === "leave" ? 85 : 70,
  }))));
});

router.get("/attendance/today", async (_req, res): Promise<void> => {
  const [records, children] = await Promise.all([
    db.select().from(attendanceTable).where(eq(attendanceTable.date, today())),
    db.select().from(childrenTable),
  ]);
  const childMap = new Map(children.map((child) => [child.id, child]));
  res.json(GetTodayAttendanceResponse.parse(records.map((record) => {
    const child = childMap.get(record.childId);
    return {
      ...record,
      childName: child ? `${child.firstName} ${child.lastName}` : "طفل غير معروف",
    };
  })));
});

router.post("/attendance", async (req, res): Promise<void> => {
  const parsed = RecordAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [child] = await db.select().from(childrenTable).where(eq(childrenTable.id, parsed.data.childId));
  if (!child) {
    res.status(404).json({ error: "Child not found" });
    return;
  }
  const [existing] = await db.select().from(attendanceTable).where(and(
    eq(attendanceTable.childId, parsed.data.childId),
    eq(attendanceTable.date, parsed.data.date),
  ));
  const payload = {
    status: parsed.data.status,
    checkIn: parsed.data.checkIn ?? null,
    checkOut: parsed.data.checkOut ?? null,
    note: parsed.data.note ?? null,
  };
  const [record] = existing
    ? await db.update(attendanceTable).set(payload).where(eq(attendanceTable.id, existing.id)).returning()
    : await db.insert(attendanceTable).values({ childId: parsed.data.childId, date: parsed.data.date, ...payload }).returning();
  res.status(201).json(RecordAttendanceResponse.parse({
    ...record,
    childName: `${child.firstName} ${child.lastName}`,
  }));
});

router.get("/finance/summary", async (_req, res): Promise<void> => {
  const invoices = await db.select().from(invoicesTable);
  const collectedThisMonth = invoices.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const outstanding = invoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  res.json(GetFinanceSummaryResponse.parse({
    collectedThisMonth,
    outstanding,
    overdueCount: invoices.filter((invoice) => invoice.status === "overdue").length,
    paidCount: invoices.filter((invoice) => invoice.status === "paid").length,
    monthlyTrend: [
      { month: "يونيو", collected: Math.round(collectedThisMonth * 0.7), expected: Math.round((collectedThisMonth + outstanding) * 0.8) },
      { month: "يوليو", collected: Math.round(collectedThisMonth * 0.85), expected: Math.round((collectedThisMonth + outstanding) * 0.9) },
      { month: "أغسطس", collected: collectedThisMonth, expected: collectedThisMonth + outstanding },
    ],
  }));
});

router.get("/invoices", async (req, res): Promise<void> => {
  const parsed = ListInvoicesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [invoices, guardians, children] = await Promise.all([
    db.select().from(invoicesTable),
    db.select().from(guardiansTable),
    db.select().from(childrenTable),
  ]);
  const guardianMap = new Map(guardians.map((guardian) => [guardian.id, guardian]));
  const childMap = new Map(children.map((child) => [child.id, child]));
  const rows = invoices
    .filter((invoice) => !parsed.data.status || invoice.status === parsed.data.status)
    .map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      guardianName: guardianMap.get(invoice.guardianId)?.name ?? "ولي أمر",
      childName: (() => {
        const child = childMap.get(invoice.childId);
        return child ? `${child.firstName} ${child.lastName}` : "طفل";
      })(),
      amount: invoice.amount,
      dueDate: invoice.dueDate,
      status: invoice.status,
    }));
  res.json(ListInvoicesResponse.parse(rows));
});

export default router;