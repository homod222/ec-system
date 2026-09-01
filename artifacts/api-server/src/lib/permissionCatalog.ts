export const permissionCatalog = [
  {
    module: "organization",
    page: "branches",
    operations: ["read:branch", "write:branch", "delete:branch"],
  },
  {
    module: "organization",
    page: "stages",
    operations: ["read:stage", "write:stage", "delete:stage"],
  },
  {
    module: "organization",
    page: "settings",
    operations: [
      "read:setting", "write:setting", "delete:setting",
      "read:holiday", "write:holiday", "delete:holiday",
      "read:integration", "write:integration", "delete:integration",
    ],
  },
  {
    module: "people",
    page: "children",
    operations: [
      "read:children", "write:children", "delete:children",
      "read:child-record", "read:child-confidential",
      "write:child-health", "write:child-emergency", "write:child-allergy",
      "write:child-medication", "write:child-document", "write:child-photo",
      "write:child-note", "write:child-history",
    ],
  },
  {
    module: "people",
    page: "users",
    operations: [
      "read:users", "write:users", "delete:users",
    ],
  },
  {
    module: "people",
    page: "staff",
    operations: [
      "read:staff-profile", "write:staff-profile", "delete:staff-profile",
      "read:staff-job", "write:staff-job", "delete:staff-job",
      "read:staff-leave", "write:staff-leave", "delete:staff-leave",
      "read:teacher-assignment", "write:teacher-assignment", "delete:teacher-assignment",
      "read:evaluation", "write:evaluation", "delete:evaluation",
    ],
  },
  {
    module: "attendance",
    page: "attendance",
    operations: ["read:attendance", "write:attendance"],
  },
  {
    module: "academics",
    page: "classrooms",
    operations: ["read:classroom-schedule", "write:classroom-schedule", "delete:classroom-schedule"],
  },
  {
    module: "academics",
    page: "curriculum",
    operations: [
      "read:curriculum", "write:curriculum", "delete:curriculum",
      "read:lesson-plan", "write:lesson-plan", "delete:lesson-plan",
      "read:skill", "write:skill", "delete:skill",
    ],
  },
  {
    module: "academics",
    page: "assessment",
    operations: [
      "read:assessment", "write:assessment", "delete:assessment",
      "read:progress-report", "write:progress-report", "delete:progress-report",
    ],
  },
  {
    module: "communications",
    page: "activities",
    operations: [
      "read:event", "write:event", "delete:event",
      "read:media", "write:media", "delete:media",
      "read:notification", "write:notification", "delete:notification",
    ],
  },
  {
    module: "finance",
    page: "fees",
    operations: [
      "read:fee-plan", "write:fee-plan", "delete:fee-plan",
      "read:discount", "write:discount", "delete:discount",
    ],
  },
  {
    module: "finance",
    page: "accounting",
    operations: [
      "read:refund", "write:refund", "delete:refund",
      "read:expense", "write:expense", "delete:expense",
      "read:revenue", "write:revenue", "delete:revenue",
      "read:payroll", "write:payroll", "delete:payroll",
      "read:invoice", "write:invoice", "write:payment",
    ],
  },
  {
    module: "reports",
    page: "reports",
    operations: ["read:report-operational", "read:report-academic", "read:report-financial"],
  },
  {
    module: "admissions",
    page: "applications",
    operations: [
      "read:application", "write:application", "accept:application",
      "write:application-document",
    ],
  },
  {
    module: "website",
    page: "gallery",
    operations: [
      "read:site-gallery", "create:site-gallery", "update:site-gallery",
      "publish:site-gallery", "delete:site-gallery", "reorder:site-gallery",
    ],
  },
  {
    module: "security",
    page: "permissions",
    operations: ["read:permissions", "read:audit"],
  },
  {
    module: "dashboard",
    page: "dashboard",
    operations: ["read:dashboard"],
  },
] as const satisfies readonly {
  module: string;
  page: string;
  operations: readonly string[];
}[];

export type ConfigurableOperation = (typeof permissionCatalog)[number]["operations"][number];

export const configurableOperations: readonly ConfigurableOperation[] =
  permissionCatalog.flatMap((group) => group.operations);

export const configurableOperationSet: ReadonlySet<string> = new Set(configurableOperations);
