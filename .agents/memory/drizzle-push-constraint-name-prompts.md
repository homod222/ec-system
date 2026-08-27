---
name: Drizzle push constraint-name prompts
description: How to handle non-interactive truncation prompts caused by unique-constraint naming drift.
---

Do not accept or work around a `drizzle-kit push` prompt that offers to truncate a populated table merely to add a unique constraint. First inspect the data for duplicates and inspect both PostgreSQL constraints and indexes. A pre-existing unique index or auto-named unique constraint may enforce the same columns while Drizzle still considers the schema constraint missing because its name differs.

**Why:** In a non-interactive workflow, Drizzle stopped a safe additive schema update and suggested truncating unrelated populated tables even though the relevant unique values had no duplicates and uniqueness was already enforced under another name.

**How to apply:** If there are no duplicates, add the exact named PostgreSQL constraint expected by the schema (or reconcile the naming) without deleting rows. Apply unrelated additive changes separately if needed, and never approve truncation as a shortcut.