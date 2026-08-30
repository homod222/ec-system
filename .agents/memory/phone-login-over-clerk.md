---
name: Phone login over Clerk
description: Architectural and privacy rules for the custom WhatsApp OTP entry flow backed by Clerk sessions.
---

Use WhatsApp OTP as the normal public sign-in experience while keeping Clerk as the source of session identity and authorization. After OTP verification, exchange a short-lived, one-time server-issued Clerk ticket in the browser. Keep a deliberately separate Clerk recovery path for the owner.

**Why:** The managed Clerk setup does not provide the required native phone login, while the existing roles and tenant isolation depend on Clerk identities. The owner must not be locked out during migration.

**How to apply:** Phone mappings must be unique. Unknown or ambiguous numbers receive a generic response and no message. A uniquely recognized number may show only the first name before verification, per the accepted product tradeoff. Do not restore a public Clerk sign-up or social-login surface.