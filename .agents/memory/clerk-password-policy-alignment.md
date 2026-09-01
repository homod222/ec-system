---
name: Clerk password policy alignment
description: Keep custom registration validation synchronized with the managed Clerk tenant’s password requirements.
---

Custom password registration must require at least 15 characters and must surface Clerk password-policy rejection separately from OTP errors.

**Why:** The managed Clerk tenant rejected otherwise valid OTP registrations because the custom form allowed 8-character passwords while Clerk required 15, making the UI incorrectly blame the verification code.

**How to apply:** Keep the OpenAPI contract, server validation, and frontend constraints aligned at 15 characters; map identity-provider password and duplicate-email errors to specific user-facing messages.