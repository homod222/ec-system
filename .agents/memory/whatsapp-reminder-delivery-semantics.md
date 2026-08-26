---
name: WhatsApp reminder delivery semantics
description: Reliability tradeoff for automatic WhatsApp reminders when provider sends have no idempotency key.
---

Automatic WhatsApp reminder dispatch uses a durable unique claim per invoice and reminder stage before contacting Meta. Confirmed failures may retry, successful stages remain closed, and uncertain in-flight claims use a lease before recovery.

**Why:** Meta's WhatsApp message call does not provide an idempotency key. A crash between provider acceptance and local result persistence makes strict exactly-once delivery impossible; permanent claim locking would instead lose reminders after pre-send crashes.

**How to apply:** Preserve the claim state machine when changing automatic notification workers. Reconcile confirmed notification results first, prevent normal concurrent duplicates, and recover stale uncertain claims after a deliberate lease.