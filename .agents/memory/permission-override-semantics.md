---
name: Permission override semantics
description: Defines how individual-user permission overrides relate to role permissions and how the UI must explain them.
---

An explicit user permission is evaluated before the user's role permission; without a user override, the role value remains the effective baseline.

**Why:** Showing an arbitrary or administrator baseline for individual users makes the permissions screen misleading and can cause an operator to invert the intended access.

**How to apply:** Any per-user permissions UI must obtain or require the user's actual base role, distinguish inherited values from direct overrides, and keep server authorization tied to the authenticated session's real role.