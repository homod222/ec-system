---
name: Password accounts over Clerk
description: Architectural and privacy rules for password login plus WhatsApp OTP onboarding and recovery backed by Clerk.
---

Use phone plus password as the normal public sign-in experience. Keep WhatsApp OTP for first-time onboarding and password recovery only. Clerk remains the sole source of passwords, sessions, and authorization; the server verifies passwords with Clerk and returns only a short-lived sign-in ticket. Keep a deliberately separate Clerk recovery path for the owner. A staff registrant stays pending until the owner assigns a role and approves access; do not revive a separate OTP-based staff activation flow.

**Why:** Daily password login is simpler for families and staff, while verified phone ownership is still required for safe account linking and recovery. Existing roles and tenant isolation depend on Clerk identities, and the owner must not be locked out.

**How to apply:** Resolve phone identities only inside the public nursery tenant and require a unique match. Unknown or ambiguous identifiers receive generic responses. Send WhatsApp only for a verified, uniquely bound phone. Never store passwords locally or expose a public Clerk sign-up/social-login surface.