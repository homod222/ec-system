---
name: Replit-managed Stripe connector — webhook secret and currency limitations
description: Two non-obvious constraints when integrating Stripe via the Replit connector/stripe-replit-sync managed-webhook flow — no exposed signing secret, and account-level presentment-currency limits.
---

## No exposed webhook signing secret
The Replit Stripe connection's settings object only exposes `secret` (the API secret key), `publishable`, `mcp`, and `claim_url` — there is no `webhook_secret` field. When using `stripe-replit-sync`'s managed-webhook flow (`findOrCreateManagedWebhook`), the signing secret is generated and kept internal to that library; application code cannot fetch it to do its own `stripe.webhooks.constructEvent` verification.

**How to apply:** structure webhook handling as `WebhookHandlers.processWebhook(payload, signature)` (from `stripe-replit-sync`, which verifies internally and throws on bad signatures) followed immediately by your own domain reconciliation logic that trusts the already-parsed payload — don't try to re-verify the signature yourself, and don't expect a `webhook_secret` to appear in the connection settings.

## KWD (and likely other exotic currencies) unsupported as Stripe presentment currency
A live checkout-session creation call against the connected Stripe sandbox account returned `Invalid currency: kwd ... Your account currently supports these currencies: usd, aed, ...` — KWD was entirely absent from the list of ~140 supported currencies. This is an account/region limitation (Stripe requires a bank account in that settlement currency, and full Kuwait-based Stripe merchant accounts are not generally available), not something fixable from application code.

**Why:** worth knowing before assuming any ISO currency code will work with `price_data.currency` — verify empirically for the target account/currency early, since the failure only surfaces as a runtime API error with no earlier warning.

**How to apply:** when a project's native currency isn't Stripe-supported, charge in a supported currency (e.g. USD) via an explicit, documented conversion, and store the actually-charged amount/currency/rate on the record (invoice, order, etc.) from the webhook payload itself for audit — don't just trust your own pre-computed conversion.
