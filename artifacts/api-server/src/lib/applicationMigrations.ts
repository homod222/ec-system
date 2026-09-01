import { pool } from "@workspace/db";
import { logger } from "./logger";
import { hashPassword } from "./localAuth";

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
      ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS clerk_user_id text,
      ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'unlinked',
      ADD COLUMN IF NOT EXISTS otp_hash text,
      ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS otp_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS password_reset_hash text,
      ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS password_reset_requested_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS staff_clerk_user_id_unique ON staff (clerk_user_id);
    ALTER TABLE attendance
      ADD COLUMN IF NOT EXISTS departure_type text,
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS recorded_by text,
      ADD COLUMN IF NOT EXISTS pickup_name text,
      ADD COLUMN IF NOT EXISTS pickup_identity text,
      ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
      ADD COLUMN IF NOT EXISTS correction_reason text;
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__legacy__',
      ADD COLUMN IF NOT EXISTS stripe_checkout_attempt integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS myfatoorah_invoice_id text,
      ADD COLUMN IF NOT EXISTS myfatoorah_payment_id text,
      ADD COLUMN IF NOT EXISTS myfatoorah_payment_url text,
      ADD COLUMN IF NOT EXISTS myfatoorah_checkout_attempt integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS issued_at timestamptz,
      ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
      ADD COLUMN IF NOT EXISTS cancellation_reason text,
      ADD COLUMN IF NOT EXISTS billing_plan_id integer,
      ADD COLUMN IF NOT EXISTS installment_id integer,
      ADD COLUMN IF NOT EXISTS payment_method text,
      ADD COLUMN IF NOT EXISTS payment_reference text,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ALTER COLUMN amount TYPE numeric(12, 3),
      ALTER COLUMN charged_amount TYPE numeric(12, 3);
    ALTER TABLE application_documents
      ADD COLUMN IF NOT EXISTS child_id integer,
      ADD COLUMN IF NOT EXISTS parent_visible boolean NOT NULL DEFAULT true;
    ALTER TABLE upload_grants
      ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'application-document',
      ADD COLUMN IF NOT EXISTS target_id integer;
    UPDATE upload_grants
      SET target_type = 'application-document', target_id = application_id
      WHERE application_id IS NOT NULL AND target_id IS NULL;
    ALTER TABLE upload_grants ALTER COLUMN application_id DROP NOT NULL;
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
    CREATE TABLE IF NOT EXISTS user_permissions (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      user_id text NOT NULL,
      operation text NOT NULL,
      allowed boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT user_permissions_owner_user_operation_unique UNIQUE (owner_id, user_id, operation)
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
    CREATE TABLE IF NOT EXISTS child_contacts (
      id serial PRIMARY KEY, owner_id text NOT NULL, child_id integer NOT NULL,
      type text NOT NULL, name text NOT NULL, relationship text, phone text, email text,
      identity_number text, status text NOT NULL DEFAULT 'active',
      "primary" boolean NOT NULL DEFAULT false, data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id serial PRIMARY KEY, owner_id text NOT NULL, invoice_id integer NOT NULL,
      type text NOT NULL DEFAULT 'fee', description text NOT NULL,
      quantity numeric(10,3) NOT NULL DEFAULT 1, unit_amount numeric(12,3) NOT NULL,
      amount numeric(12,3) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id serial PRIMARY KEY, owner_id text NOT NULL, invoice_id integer NOT NULL,
      method text NOT NULL, amount numeric(12,3) NOT NULL, currency text NOT NULL DEFAULT 'KWD',
      status text NOT NULL, reference text, note text, recorded_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id serial PRIMARY KEY,
      invoice_id integer NOT NULL,
      attempt_number integer NOT NULL,
      customer_reference text NOT NULL UNIQUE,
      provider_invoice_id text UNIQUE,
      provider_payment_id text,
      payment_url text,
      status text NOT NULL,
      amount numeric(12, 3) NOT NULL,
      currency text NOT NULL DEFAULT 'KWD',
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT payment_attempts_invoice_attempt_unique UNIQUE (invoice_id, attempt_number)
    );
    CREATE TABLE IF NOT EXISTS invoice_refunds (
      id serial PRIMARY KEY, owner_id text NOT NULL, invoice_id integer NOT NULL,
      payment_id integer, amount numeric(12,3) NOT NULL, reason text NOT NULL,
      recorded_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS invoice_receipts (
      id serial PRIMARY KEY, owner_id text NOT NULL, invoice_id integer NOT NULL,
      payment_id integer NOT NULL, receipt_number text NOT NULL,
      amount numeric(12,3) NOT NULL, issued_by text NOT NULL,
      issued_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS nursery_settings (
      id serial PRIMARY KEY, owner_id text NOT NULL, nursery_name text NOT NULL,
      registration_whatsapp text NOT NULL DEFAULT '96590916677',
      timezone text NOT NULL DEFAULT 'Asia/Kuwait', currency text NOT NULL DEFAULT 'KWD',
      working_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
      calendar jsonb NOT NULL DEFAULT '{}'::jsonb, updated_by text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE nursery_settings
      ADD COLUMN IF NOT EXISTS registration_whatsapp text NOT NULL DEFAULT '96590916677';
    CREATE TABLE IF NOT EXISTS billing_plans (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      child_id integer NOT NULL,
      guardian_id integer NOT NULL,
      title text NOT NULL,
      cadence text NOT NULL,
      total_amount numeric(12,3) NOT NULL,
      discount_amount numeric(12,3) NOT NULL DEFAULT 0,
      net_amount numeric(12,3) NOT NULL,
      installment_count integer NOT NULL,
      issue_lead_days integer NOT NULL DEFAULT 7,
      status text NOT NULL DEFAULT 'active',
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS billing_installments (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      plan_id integer NOT NULL,
      sequence integer NOT NULL,
      amount numeric(12,3) NOT NULL,
      issue_date date NOT NULL,
      due_date date NOT NULL,
      status text NOT NULL DEFAULT 'scheduled',
      invoice_id integer,
      generated_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS progress_reports (
      id serial PRIMARY KEY, owner_id text NOT NULL DEFAULT '__legacy__', child_id integer NOT NULL,
      title text NOT NULL, summary text NOT NULL, period text NOT NULL, educator_name text NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS child_activities (
      id serial PRIMARY KEY, owner_id text NOT NULL DEFAULT '__legacy__', child_id integer NOT NULL,
      category text NOT NULL, title text NOT NULL, description text NOT NULL, photo_url text,
      educator_name text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS parent_messages (
      id serial PRIMARY KEY, owner_id text NOT NULL DEFAULT '__legacy__', guardian_id integer NOT NULL,
      sender_type text NOT NULL, sender_name text NOT NULL, subject text NOT NULL, content text NOT NULL,
      read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id serial PRIMARY KEY, owner_id text NOT NULL DEFAULT '__legacy__', title text NOT NULL,
      content text NOT NULL, audience text NOT NULL DEFAULT 'all',
      published_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS site_gallery_items (
      id serial PRIMARY KEY,
      owner_id text NOT NULL,
      title text NOT NULL,
      alt_text text NOT NULL,
      object_path text NOT NULL UNIQUE,
      content_type text NOT NULL,
      size integer NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'draft',
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT site_gallery_items_status_check CHECK (status IN ('draft', 'published', 'hidden')),
      CONSTRAINT site_gallery_items_content_type_check CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
      CONSTRAINT site_gallery_items_size_check CHECK (size > 0 AND size <= 10485760)
    );
    ALTER TABLE site_gallery_items DROP CONSTRAINT IF EXISTS site_gallery_items_status_check;
    ALTER TABLE site_gallery_items ADD CONSTRAINT site_gallery_items_status_check
      CHECK (status IN ('draft', 'published', 'hidden', 'deleting'));

    CREATE TABLE IF NOT EXISTS phone_login_identities (
      id serial PRIMARY KEY,
      clerk_user_id text NOT NULL UNIQUE,
      normalized_phone text NOT NULL UNIQUE,
      first_name text NOT NULL,
      verified_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS phone_otp_challenges (
      id text PRIMARY KEY,
      purpose text NOT NULL,
      normalized_phone_hash text NOT NULL,
      normalized_phone text,
      ip_hash text NOT NULL,
      otp_hash text NOT NULL,
      clerk_user_id text,
      first_name text,
      requested_by text,
      expires_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS phone_otp_phone_created_idx
      ON phone_otp_challenges (normalized_phone_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS phone_otp_ip_created_idx
      ON phone_otp_challenges (ip_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS phone_otp_expiry_idx
      ON phone_otp_challenges (expires_at);

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
    CREATE UNIQUE INDEX IF NOT EXISTS user_permissions_owner_user_operation_unique
      ON user_permissions (owner_id, user_id, operation);
    CREATE INDEX IF NOT EXISTS audit_logs_owner_created_idx
      ON audit_logs (owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_owner_operation_idx
      ON audit_logs (owner_id, operation, entity_type, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS nursery_branches_owner_code_unique
      ON nursery_branches (owner_id, code);
    CREATE TABLE IF NOT EXISTS attendance_duplicate_archive (
      original_attendance_id integer PRIMARY KEY,
      snapshot jsonb NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT now(),
      archive_reason text NOT NULL
    );
    INSERT INTO attendance_duplicate_archive (original_attendance_id, snapshot, archive_reason)
      SELECT older.id, to_jsonb(older), 'duplicate child/date archived before daily uniqueness enforcement'
      FROM attendance older
      WHERE EXISTS (
        SELECT 1 FROM attendance newer
        WHERE newer.child_id = older.child_id AND newer.date = older.date AND newer.id > older.id
      )
      ON CONFLICT (original_attendance_id) DO NOTHING;
    -- The newest correction stays active; every older row remains recoverable in the archive.
    DELETE FROM attendance older
      USING attendance newer
      WHERE older.child_id = newer.child_id AND older.date = newer.date AND older.id < newer.id;
    UPDATE invoice_payments SET status = 'completed' WHERE status = 'succeeded';
    INSERT INTO invoice_payments (
      owner_id, invoice_id, method, amount, currency, status,
      reference, note, recorded_by, created_at
    )
    SELECT
      invoice.owner_id,
      invoice.id,
      CASE
        WHEN nullif(invoice.payment_method, '') IS NOT NULL THEN invoice.payment_method
        WHEN nullif(invoice.stripe_payment_intent_id, '') IS NOT NULL THEN 'payment_link'
        ELSE 'legacy'
      END,
      invoice.amount,
      'KWD',
      'completed',
      coalesce(
        nullif(invoice.payment_reference, ''),
        nullif(invoice.stripe_payment_intent_id, ''),
        'legacy-invoice-' || invoice.id::text
      ),
      'Backfilled from the settled legacy invoice record',
      'migration',
      coalesce(invoice.paid_at, invoice.created_at, now())
    FROM invoices invoice
    WHERE invoice.status = 'paid'
      AND invoice.owner_id <> '__legacy__'
      AND NOT EXISTS (
        SELECT 1
        FROM invoice_payments payment
        WHERE payment.owner_id = invoice.owner_id
          AND payment.invoice_id = invoice.id
          AND payment.status IN ('completed', 'succeeded')
      );
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_child_day_unique ON attendance (child_id, date);
    CREATE INDEX IF NOT EXISTS child_contacts_owner_child_idx ON child_contacts (owner_id, child_id, type);
    CREATE INDEX IF NOT EXISTS invoice_lines_owner_invoice_idx ON invoice_lines (owner_id, invoice_id);
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_owner_number_unique ON invoices (owner_id, invoice_number);
    CREATE INDEX IF NOT EXISTS invoice_payments_owner_invoice_idx ON invoice_payments (owner_id, invoice_id);
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_myfatoorah_invoice_id_unique
      ON invoices (myfatoorah_invoice_id) WHERE myfatoorah_invoice_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS invoice_refunds_owner_invoice_idx ON invoice_refunds (owner_id, invoice_id);
    CREATE UNIQUE INDEX IF NOT EXISTS invoice_receipts_owner_payment_unique ON invoice_receipts (owner_id, payment_id);
    CREATE UNIQUE INDEX IF NOT EXISTS invoice_receipts_owner_number_unique ON invoice_receipts (owner_id, receipt_number);
    CREATE UNIQUE INDEX IF NOT EXISTS nursery_settings_owner_unique ON nursery_settings (owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS billing_installments_plan_sequence_unique
      ON billing_installments (plan_id, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS billing_installments_invoice_unique
      ON billing_installments (invoice_id) WHERE invoice_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS billing_plans_owner_idx ON billing_plans (owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS billing_installments_generation_idx
      ON billing_installments (status, issue_date);
    CREATE INDEX IF NOT EXISTS site_gallery_items_owner_order_idx
      ON site_gallery_items (owner_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS site_gallery_items_public_idx
      ON site_gallery_items (owner_id, status, sort_order) WHERE status = 'published';

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
      ADD COLUMN IF NOT EXISTS clerk_user_id text,
      ADD COLUMN IF NOT EXISTS identity_key text;
    UPDATE guardians
      SET identity_key = CASE
        WHEN nullif(lower(trim(email)), '') IS NOT NULL THEN 'email:' || lower(trim(email))
        WHEN nullif(regexp_replace(phone, '[^0-9+]', '', 'g'), '') IS NOT NULL THEN 'phone:' || regexp_replace(phone, '[^0-9+]', '', 'g')
        ELSE NULL
      END
      WHERE identity_key IS NULL;
    -- A deterministic canonical guardian retains account linkage; child rows are
    -- reassigned before duplicate guardians are removed.
    WITH ranked AS (
      SELECT id, owner_id, identity_key,
        first_value(id) OVER (PARTITION BY owner_id, identity_key ORDER BY (clerk_user_id IS NOT NULL) DESC, id) AS canonical_id,
        row_number() OVER (PARTITION BY owner_id, identity_key ORDER BY (clerk_user_id IS NOT NULL) DESC, id) AS rank
      FROM guardians WHERE identity_key IS NOT NULL
    )
    UPDATE children child SET guardian_id = ranked.canonical_id
      FROM ranked WHERE child.guardian_id = ranked.id AND ranked.rank > 1;
    WITH ranked AS (
      SELECT id, owner_id, identity_key,
        first_value(id) OVER (PARTITION BY owner_id, identity_key ORDER BY (clerk_user_id IS NOT NULL) DESC, id) AS canonical_id,
        row_number() OVER (PARTITION BY owner_id, identity_key ORDER BY (clerk_user_id IS NOT NULL) DESC, id) AS rank
      FROM guardians WHERE identity_key IS NOT NULL
    )
    UPDATE invoices invoice SET guardian_id = ranked.canonical_id
      FROM ranked WHERE invoice.guardian_id = ranked.id AND ranked.rank > 1;
    WITH ranked AS (
      SELECT id, owner_id, identity_key,
        first_value(id) OVER (PARTITION BY owner_id, identity_key ORDER BY (clerk_user_id IS NOT NULL) DESC, id) AS canonical_id,
        row_number() OVER (PARTITION BY owner_id, identity_key ORDER BY (clerk_user_id IS NOT NULL) DESC, id) AS rank
      FROM guardians WHERE identity_key IS NOT NULL
    )
    UPDATE parent_messages message SET guardian_id = ranked.canonical_id
      FROM ranked WHERE message.guardian_id = ranked.id AND ranked.rank > 1;
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY owner_id, identity_key ORDER BY (clerk_user_id IS NOT NULL) DESC, id) AS rank
      FROM guardians WHERE identity_key IS NOT NULL
    )
    DELETE FROM guardians guardian USING ranked
      WHERE guardian.id = ranked.id AND ranked.rank > 1;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS guardians_clerk_user_id_unique
      ON guardians (clerk_user_id)
    ;
    CREATE UNIQUE INDEX IF NOT EXISTS guardians_owner_identity_key_unique
      ON guardians (owner_id, identity_key) WHERE identity_key IS NOT NULL
  `);
  // ---------------------------------------------------------------------------
  // Local auth migration: ensure public_auth_accounts has password_hash & role,
  // and phone_otp_challenges has the registration columns.
  // ---------------------------------------------------------------------------
  await pool.query(`
    ALTER TABLE phone_otp_challenges
      ADD COLUMN IF NOT EXISTS full_name text,
      ADD COLUMN IF NOT EXISTS email text,
      ADD COLUMN IF NOT EXISTS account_type text;

    CREATE TABLE IF NOT EXISTS public_auth_accounts (
      id serial PRIMARY KEY,
      normalized_phone text NOT NULL UNIQUE,
      clerk_user_id text,
      full_name text NOT NULL,
      email text NOT NULL,
      account_type text NOT NULL,
      account_status text NOT NULL DEFAULT 'pending',
      owner_id text,
      guardian_id integer,
      staff_id integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public_auth_accounts
      ADD COLUMN IF NOT EXISTS password_hash text,
      ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'pending';

    ALTER TABLE public_auth_accounts
      ALTER COLUMN clerk_user_id DROP NOT NULL;

    DROP INDEX IF EXISTS public_auth_accounts_clerk_user_id_key;

    CREATE UNIQUE INDEX IF NOT EXISTS public_auth_accounts_email_unique
      ON public_auth_accounts (lower(email));
  `);

  // ---------------------------------------------------------------------------
  // Seed default admin account (idempotent — skips if phone already exists)
  // ---------------------------------------------------------------------------
  const adminPhone = "96560607740";
  const existing = await pool.query(
    `SELECT id FROM public_auth_accounts WHERE normalized_phone = $1 LIMIT 1`,
    [adminPhone],
  );
  if (existing.rows.length === 0) {
    const pwHash = await hashPassword("60607740");
    const ownerId = process.env.PUBLIC_SITE_OWNER_ID?.trim() || null;
    const result = await pool.query(
      `INSERT INTO public_auth_accounts
        (normalized_phone, full_name, email, password_hash, account_type, account_status, role, owner_id)
       VALUES ($1, $2, $3, $4, 'staff', 'active', 'admin', $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [adminPhone, "Homod Ali Alnomasi", "homod222@hotmail.com", pwHash, ownerId],
    );
    if (result.rows.length > 0) {
      logger.info({ accountId: result.rows[0].id }, "Default admin account created");
    }
  }

  logger.info("Application database migrations completed");
}