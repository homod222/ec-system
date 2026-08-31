#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile

# Apply the ordered, idempotent development migrations, including data
# backfills that a declarative schema push cannot express. Replit Publish
# separately applies the resulting Drizzle schema diff to production.
for migration in lib/db/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

push_log="$(mktemp)"
trap 'rm -f "$push_log"' EXIT
pnpm --filter @workspace/db run push 2>&1 | tee "$push_log"
if grep -q "Interactive prompts require a TTY" "$push_log"; then
  echo "Drizzle requested an unsafe interactive schema decision; refusing post-merge setup." >&2
  exit 1
fi
