import app from "./app";
import { logger } from "./lib/logger";
import { startScheduledDueReminders } from "./lib/scheduledDueReminders";
import { runApplicationMigrations } from "./lib/applicationMigrations";
import { startPaymentReconciliationScheduler } from "./lib/paymentReconciliationScheduler";
import { startBillingPlanScheduler } from "./lib/billingPlanScheduler";

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

async function start(): Promise<void> {
  await runApplicationMigrations();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    startScheduledDueReminders();
    startPaymentReconciliationScheduler();
    startBillingPlanScheduler();
  });
}

start().catch((err) => {
  logger.error({ err }, "Unable to start API server");
  process.exit(1);
});
