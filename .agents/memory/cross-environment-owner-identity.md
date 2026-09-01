---
name: Cross-environment owner identity
description: How the nursery owner remains recognized when Clerk user IDs differ across environments.
---

Treat a session as the nursery owner when either its Clerk user ID matches the configured canonical owner ID or one of its Clerk-verified emails matches one of the configured owner emails. An email match must never use an unverified address.

**Why:** Clerk user IDs can differ between Development and Production, and owner metadata can temporarily say `pending`. ID-only or metadata-only checks can incorrectly send the real owner to account review.

**How to apply:** Use the same owner-identity rule for both session routing and authorization context. Store multiple owner emails as a delimiter-separated shared setting. When a canonical owner ID is configured, keep using it as the data tenant ID even when the authenticated Clerk ID differs.