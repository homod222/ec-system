ALTER TABLE phone_otp_challenges ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE phone_otp_challenges ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE phone_otp_challenges ADD COLUMN IF NOT EXISTS account_type text;

CREATE TABLE IF NOT EXISTS public_auth_accounts (
  id serial PRIMARY KEY,
  normalized_phone text NOT NULL UNIQUE,
  clerk_user_id text NOT NULL UNIQUE,
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
CREATE UNIQUE INDEX IF NOT EXISTS public_auth_accounts_email_unique
  ON public_auth_accounts (lower(email));

-- Preserve eligible existing password accounts during the transition.
-- Ambiguous duplicate phones or emails are intentionally quarantined instead
-- of being guessed across guardian/staff or nursery boundaries.
WITH raw_candidates AS (
  SELECT
    CASE
      WHEN regexp_replace(phone, '\D', '', 'g') LIKE '00965%'
        THEN substring(regexp_replace(phone, '\D', '', 'g') FROM 3)
      WHEN length(regexp_replace(phone, '\D', '', 'g')) = 8
        THEN '965' || regexp_replace(phone, '\D', '', 'g')
      ELSE regexp_replace(phone, '\D', '', 'g')
    END AS normalized_phone,
    clerk_user_id,
    name AS full_name,
    coalesce(nullif(lower(trim(email)), ''), 'legacy-guardian-' || id || '@invalid.local') AS email,
    'guardian'::text AS account_type,
    'active'::text AS account_status,
    owner_id,
    id AS guardian_id,
    NULL::integer AS staff_id
  FROM guardians
  WHERE clerk_user_id IS NOT NULL

  UNION ALL

  SELECT
    CASE
      WHEN regexp_replace(phone, '\D', '', 'g') LIKE '00965%'
        THEN substring(regexp_replace(phone, '\D', '', 'g') FROM 3)
      WHEN length(regexp_replace(phone, '\D', '', 'g')) = 8
        THEN '965' || regexp_replace(phone, '\D', '', 'g')
      ELSE regexp_replace(phone, '\D', '', 'g')
    END AS normalized_phone,
    clerk_user_id,
    name AS full_name,
    coalesce(nullif(lower(trim(email)), ''), 'legacy-staff-' || id || '@invalid.local') AS email,
    'staff'::text AS account_type,
    CASE WHEN account_status = 'active' THEN 'active' ELSE 'pending' END AS account_status,
    owner_id,
    NULL::integer AS guardian_id,
    id AS staff_id
  FROM staff
  WHERE clerk_user_id IS NOT NULL
),
unambiguous_candidates AS (
  SELECT *,
    count(*) OVER (PARTITION BY normalized_phone) AS phone_count,
    count(*) OVER (PARTITION BY lower(email)) AS email_count,
    count(*) OVER (PARTITION BY clerk_user_id) AS clerk_count
  FROM raw_candidates
  WHERE normalized_phone ~ '^965[569][0-9]{7}$'
)
INSERT INTO public_auth_accounts (
  normalized_phone,
  clerk_user_id,
  full_name,
  email,
  account_type,
  account_status,
  owner_id,
  guardian_id,
  staff_id
)
SELECT
  normalized_phone,
  clerk_user_id,
  full_name,
  email,
  account_type,
  account_status,
  owner_id,
  guardian_id,
  staff_id
FROM unambiguous_candidates
WHERE phone_count = 1 AND email_count = 1 AND clerk_count = 1
ON CONFLICT DO NOTHING;