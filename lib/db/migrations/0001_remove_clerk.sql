-- Migration: Remove Clerk dependency, add local password storage
-- Run this BEFORE deploying the new code

-- 1. Add password_hash and role columns
ALTER TABLE public_auth_accounts ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE public_auth_accounts ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'pending';

-- 2. Make clerk_user_id nullable (it was NOT NULL before)
ALTER TABLE public_auth_accounts ALTER COLUMN clerk_user_id DROP NOT NULL;

-- 3. Drop the unique index on clerk_user_id (no longer needed)
DROP INDEX IF EXISTS public_auth_accounts_clerk_user_id_key;

-- 4. Update phone_login_identities: make clerk_user_id point to account id instead
-- (We'll handle this in code; just ensure the column is flexible)

-- 5. Update guardians table: clerk_user_id will become account_id reference
-- (Keep as-is for now, code will handle the transition)
