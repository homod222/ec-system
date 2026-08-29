---
name: Managed staff identity marker
description: How to distinguish nursery-managed staff accounts from owners and unrelated Clerk users.
---

Treat a Clerk user as a nursery-managed staff account only when there is an explicit private staff marker or a recognized staff lifecycle status bound to a different tenant owner. A generic public `accountStatus` value alone is not sufficient.

**Why:** Existing owner accounts can carry unrelated or legacy status metadata. Treating any such field as a staff lifecycle flag silently changes the resolved role to disabled and causes every protected API request to return 403.

**How to apply:** Keep the private staff marker after unlinking so stale sessions remain revoked, while clearing public tenant and role metadata. Any future identity resolver must preserve this distinction and cover both legacy owners and immediate staff revocation in regression tests.