#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply non-interactive, idempotent development migrations first. Replit
# Publish separately applies the resulting Drizzle schema diff to production.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/migrations/0001_live_exchange_rates.sql
pnpm --filter db push
