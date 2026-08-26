-- Development/post-merge migration. Production receives the equivalent
-- Drizzle schema diff through Replit Publish.
CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "pair" text PRIMARY KEY NOT NULL,
  "rate" numeric(12, 6) NOT NULL,
  "source" text NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "stripe_checkout_attempt" integer DEFAULT 0 NOT NULL;