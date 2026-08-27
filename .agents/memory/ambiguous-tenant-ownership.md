---
name: Ambiguous tenant ownership
description: Safety rule for migrating legacy rows into a multi-tenant ownership model.
---

Legacy rows with ambiguous ownership must remain quarantined and unavailable to tenant APIs. Backfill ownership only when it can be derived consistently from trusted related records.

**Why:** A universal legacy fallback exposes staff PII across tenants, while blindly assigning or hiding invoices can create security and payment regressions.

**How to apply:** During ownership migrations, validate all relevant relationships, assign only consistent rows, log unresolved counts, and require exact ownership on both list and mutation paths.