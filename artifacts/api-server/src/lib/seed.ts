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

const today = new Date().toISOString().slice(0, 10);

export async function ensureNurserySeed(): Promise<void> {
  const existing = await db.select({ id: childrenTable.id }).from(childrenTable).limit(1);
  if (existing.length > 0) return;

  const guardians = await db
    .insert(guardiansTable)
    .values([
      { name: "نورة العتيبي", phone: "055 314 9876", email: "noura@example.com", balance: 0 },
      { name: "خالد القحطاني", phone: "050 781 2345", email: "khaled@example.com", balance: 450 },
      { name: "ريم السالم", phone: "056 908 1234", email: "reem@example.com", balance: 225 },
    ])
    .returning();

  const classrooms = await db
    .insert(classroomsTable)
    .values([
      { name: "فصل النجوم", level: "التمهيدي", teacherName: "الأستاذة سارة", capacity: 18, color: "teal" },
      { name: "فصل الفراشات", level: "الروضة", teacherName: "الأستاذة أمل", capacity: 16, color: "amber" },
      { name: "فصل الأصدقاء", level: "ما قبل الروضة", teacherName: "الأستاذة هدى", capacity: 14, color: "violet" },
    ])
    .returning();

  const children = await db
    .insert(childrenTable)
    .values([
      { firstName: "ليان", lastName: "القحطاني", gender: "female", birthDate: "2022-04-18", guardianId: guardians[1].id, classroomId: classrooms[0].id, level: "التمهيدي", notes: "حساسية بسيطة من الفول السوداني." },
      { firstName: "سلمان", lastName: "العتيبي", gender: "male", birthDate: "2021-09-06", guardianId: guardians[0].id, classroomId: classrooms[1].id, level: "الروضة", notes: null },
      { firstName: "جود", lastName: "السالم", gender: "female", birthDate: "2023-01-24", guardianId: guardians[2].id, classroomId: classrooms[2].id, level: "ما قبل الروضة", notes: "تحتاج وقتًا قصيرًا للتأقلم صباحًا." },
      { firstName: "تركي", lastName: "القحطاني", gender: "male", birthDate: "2022-12-12", guardianId: guardians[1].id, classroomId: classrooms[0].id, level: "التمهيدي", notes: null },
    ])
    .returning();

  await db.insert(staffTable).values([
    { name: "سارة الحربي", role: "معلمة تمهيدي", phone: "055 121 4400", status: "present" },
    { name: "أمل الشهري", role: "معلمة روضة", phone: "054 981 8831", status: "present" },
    { name: "هند الدوسري", role: "الإدارة", phone: "053 226 9902", status: "present" },
    { name: "هدى المطيري", role: "مساعدة معلمة", phone: "050 345 7721", status: "leave" },
  ]);

  await db.insert(attendanceTable).values([
    { childId: children[0].id, date: today, status: "present", checkIn: "07:42", checkOut: null, note: null },
    { childId: children[1].id, date: today, status: "late", checkIn: "08:16", checkOut: null, note: "وصل بعد بداية الحلقة الصباحية." },
    { childId: children[2].id, date: today, status: "present", checkIn: "07:51", checkOut: null, note: null },
    { childId: children[3].id, date: today, status: "absent", checkIn: null, checkOut: null, note: "إشعار غياب من ولي الأمر." },
  ]);

  await db.insert(invoicesTable).values([
    { invoiceNumber: "INV-2026-081", guardianId: guardians[1].id, childId: children[0].id, amount: 450, dueDate: today, status: "pending" },
    { invoiceNumber: "INV-2026-082", guardianId: guardians[0].id, childId: children[1].id, amount: 900, dueDate: today, status: "paid" },
    { invoiceNumber: "INV-2026-083", guardianId: guardians[2].id, childId: children[2].id, amount: 225, dueDate: "2026-08-01", status: "overdue" },
  ]);

  await db.insert(activitiesTable).values([
    { type: "attendance", title: "تم تسجيل حضور ليان", description: "وصلت ليان القحطاني إلى الحضانة الساعة 07:42.", actor: "الأستاذة سارة" },
    { type: "payment", title: "تم استلام دفعة", description: "تم سداد رسوم سلمان العتيبي لهذا الشهر.", actor: "الإدارة" },
    { type: "enrollment", title: "اكتمل ملف جود", description: "تمت مراجعة مستندات جود السالم وتفعيل تسجيلها.", actor: "الإدارة" },
  ]);
}