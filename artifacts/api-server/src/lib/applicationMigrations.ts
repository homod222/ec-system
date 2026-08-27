import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function runApplicationMigrations(): Promise<void> {
  await pool.query(`
    BEGIN;

    ALTER TABLE classrooms
      ADD COLUMN IF NOT EXISTS branch_id integer,
      ADD COLUMN IF NOT EXISTS stage_id integer,
      ADD COLUMN IF NOT EXISTS schedule jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__legacy__',
      ADD COLUMN IF NOT EXISTS branch_id integer,
      ADD COLUMN IF NOT EXISTS job_title text,
      ADD COLUMN IF NOT EXISTS email text,
      ADD COLUMN IF NOT EXISTS hire_date date,
      ADD COLUMN IF NOT EXISTS salary numeric(12,2),
      ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE attendance
      ADD COLUMN IF NOT EXISTS departure_type text,
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS recorded_by text;
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__legacy__',
      ADD COLUMN IF NOT EXISTS stripe_checkout_attempt integer NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS progress_reports ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__legacy__';
    ALTER TABLE IF EXISTS child_activities ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__legacy__';
    ALTER TABLE IF EXISTS parent_messages ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__legacy__';
    ALTER TABLE IF EXISTS announcements ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__legacy__';

    WITH candidate_owners AS (
      SELECT owner_id FROM children WHERE owner_id <> '__legacy__'
      UNION
      SELECT owner_id FROM classrooms WHERE owner_id <> '__legacy__'
      UNION
      SELECT owner_id FROM guardians WHERE owner_id <> '__legacy__'
    ),
    sole_owner AS (
      SELECT min(owner_id) AS owner_id
      FROM candidate_owners
      HAVING count(*) = 1
    )
    UPDATE staff
      SET owner_id = sole_owner.owner_id
      FROM sole_owner
      WHERE staff.owner_id = '__legacy__';

    UPDATE invoices AS invoice
      SET owner_id = child.owner_id
      FROM children AS child, guardians AS guardian
      WHERE invoice.owner_id = '__legacy__'
        AND invoice.child_id = child.id
        AND invoice.guardian_id = guardian.id
        AND child.owner_id = guardian.owner_id
        AND child.owner_id <> '__legacy__';

    CREATE TABLE IF NOT EXISTS nursery_branches (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      name text NOT NULL,
      code text NOT NULL,
      address text,
      phone text,
      capacity integer NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT true,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS nursery_stages (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      branch_id integer,
      name text NOT NULL,
      min_age_months integer,
      max_age_months integer,
      capacity integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS staff_attendance (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      staff_id integer NOT NULL,
      date date NOT NULL,
      status text NOT NULL,
      check_in text,
      check_out text,
      departure_type text,
      source text NOT NULL DEFAULT 'manual',
      note text,
      recorded_by text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      actor_id text NOT NULL,
      actor_role text,
      operation text NOT NULL,
      entity_type text NOT NULL,
      entity_id text,
      before jsonb,
      after jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS child_records (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      child_id integer NOT NULL,
      category text NOT NULL,
      title text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      occurred_on date,
      confidential boolean NOT NULL DEFAULT false,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      role text NOT NULL,
      operation text NOT NULL,
      allowed boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS operational_records (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      resource text NOT NULL,
      subject_id integer,
      branch_id integer,
      title text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      occurred_on date,
      amount numeric(12,2),
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS exchange_rates (
      pair text PRIMARY KEY,
      rate numeric(12,6) NOT NULL,
      source text NOT NULL,
      source_updated_at timestamptz NOT NULL,
      fetched_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS classrooms_branch_idx ON classrooms (branch_id);
    CREATE INDEX IF NOT EXISTS classrooms_stage_idx ON classrooms (stage_id);
    CREATE INDEX IF NOT EXISTS staff_owner_branch_idx ON staff (owner_id, branch_id);
    CREATE UNIQUE INDEX IF NOT EXISTS staff_attendance_owner_day_unique
      ON staff_attendance (owner_id, staff_id, date);
    CREATE INDEX IF NOT EXISTS child_records_owner_child_idx
      ON child_records (owner_id, child_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS operational_records_owner_resource_idx
      ON operational_records (owner_id, resource, created_at DESC);
    CREATE INDEX IF NOT EXISTS operational_records_report_idx
      ON operational_records (owner_id, branch_id, status, occurred_on DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_owner_role_operation_unique
      ON role_permissions (owner_id, role, operation);
    CREATE INDEX IF NOT EXISTS audit_logs_owner_created_idx
      ON audit_logs (owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_owner_operation_idx
      ON audit_logs (owner_id, operation, entity_type, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS nursery_branches_owner_code_unique
      ON nursery_branches (owner_id, code);

    COMMIT;
  `);
  const legacyStaff = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM staff WHERE owner_id = '__legacy__'
  `);
  if (Number(legacyStaff.rows[0]?.count ?? 0) > 0) {
    logger.warn(
      { count: Number(legacyStaff.rows[0].count) },
      "Legacy staff ownership is ambiguous; rows are quarantined until an owner is assigned",
    );
  }
  const legacyInvoices = await pool.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM invoices WHERE owner_id = '__legacy__'
  `);
  if (Number(legacyInvoices.rows[0]?.count ?? 0) > 0) {
    logger.warn(
      { count: Number(legacyInvoices.rows[0].count) },
      "Legacy invoice ownership could not be derived consistently; rows are quarantined until corrected",
    );
  }
  await pool.query(`
    ALTER TABLE payment_notifications
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS reminder_stage text
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_dispatch_claims (
      id serial PRIMARY KEY,
      deduplication_key text NOT NULL UNIQUE,
      invoice_id integer NOT NULL,
      reminder_stage text NOT NULL,
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE upload_grants
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'issued'
  `);
  await pool.query(`
    ALTER TABLE guardians
      ADD COLUMN IF NOT EXISTS clerk_user_id text
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS guardians_clerk_user_id_unique
      ON guardians (clerk_user_id)
  `);
  logger.info("Application database migrations completed");
}