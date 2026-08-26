import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripeClient";
import { startScheduledDueReminders } from "./lib/scheduledDueReminders";
import { runApplicationMigrations } from "./lib/applicationMigrations";
import { initializeExchangeRateScheduler } from "./lib/exchangeRates";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required for the Stripe integration");
  }

  try {
    await runMigrations({ databaseUrl, logger });

    const stripeSync = await getStripeSync();
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);

    stripeSync
      .syncBackfill()
      .then(() => logger.info("Stripe data synced"))
      .catch((err) => logger.error({ err }, "Error syncing Stripe data"));
  } catch (err) {
    logger.error({ err }, "Failed to initialize Stripe integration");
    throw err;
  }
}
async function start(): Promise<void> {
  await runApplicationMigrations();
  await initStripe();
  await initializeExchangeRateScheduler();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    startScheduledDueReminders();
  });
}

start().catch((err) => {
  logger.error({ err }, "Unable to start API server");
  process.exit(1);
});
