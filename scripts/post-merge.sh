#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile

# Apply the ordered, idempotent development migrations, including data
# backfills that a declarative schema push cannot express. Replit Publish
# separately applies the resulting Drizzle schema diff to production.
for migration in lib/db/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

# Do not run `drizzle-kit push` here. The development database can contain
# compatibility columns and durable auth/rate-limit data created by ordered
# migrations. A declarative push would treat those as deletions and either
# prompt in this non-interactive hook or, with --force, destroy live data.
# Schema reconciliation for production remains handled by Replit Publish.
