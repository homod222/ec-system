ALTER TABLE staff ADD COLUMN IF NOT EXISTS clerk_user_id text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'unlinked';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS otp_hash text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS otp_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_reset_hash text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_reset_requested_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS staff_clerk_user_id_unique ON staff (clerk_user_id);