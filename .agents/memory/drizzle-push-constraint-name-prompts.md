---
name: Drizzle push constraint-name prompts
description: How to handle non-interactive Drizzle prompts caused by constraint drift or intentional compatibility objects.
---

Do not accept or work around a `drizzle-kit push` prompt that offers to truncate a populated table merely to add a unique constraint. First inspect the data for duplicates and inspect both PostgreSQL constraints and indexes. A pre-existing unique index or auto-named unique constraint may enforce the same columns while Drizzle still considers the schema constraint missing because its name differs.

**Why:** Drizzle compares constraint identity as well as enforced uniqueness, so equivalent constraints with different names can produce unsafe-looking truncation prompts.

**How to apply:** If there are no duplicates, add the exact named PostgreSQL constraint expected by the schema (or reconcile the naming) without deleting rows. Apply unrelated additive changes separately if needed, and never approve truncation as a shortcut.

Do not run declarative `drizzle-kit push` automatically after ordered SQL migrations when the database intentionally retains compatibility columns, audit/rate-limit tables, or other durable objects outside the current declarative schema.

**Why:** A non-interactive `push` interpreted those populated compatibility objects as deletions. Using `--force` would have destroyed authentication and rate-limit data; leaving the prompt interactive made every post-merge setup fail.

**How to apply:** Keep the post-merge path limited to idempotent, reviewed SQL migrations. Reconcile intentional removals separately after inspecting row counts and obtaining informed approval.