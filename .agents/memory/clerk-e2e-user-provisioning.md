---
name: Clerk E2E user provisioning
description: Constraint on creating temporary users in this project's managed Clerk development instance.
---

Backend-created temporary Clerk users must include a password even when the browser test signs in later through Clerk's ticket-based testing helper.

**Why:** The development instance enforces a password requirement and rejects passwordless Backend API user creation with a 422 response.

**How to apply:** Generate a strong random password only in memory during test setup. Do not persist or log it, and delete the temporary user during global teardown.