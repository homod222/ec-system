import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function runApplicationMigrations(): Promise<void> {
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