---
name: OpenAPI integer compatibility
description: A generator/version mismatch affecting integer fields in API contracts.
---

Avoid `type: integer` in this workspace's OpenAPI specification until the Zod runtime is upgraded or the generator is configured differently; model count and ID values as numbers instead.

**Why:** The installed Zod v3 runtime does not expose `zod.int()`, while the current Orval Zod generator emits it for OpenAPI integer fields, causing the generated validation library to fail compilation.

**How to apply:** When extending the API contract, use `type: number` for numeric IDs and counts, then keep integer validation at the database or route boundary if it matters.