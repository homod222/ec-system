import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { reconcileInvoicePayment, verifyMyFatoorahWebhook, type PaymentWebhook } from "./lib/paymentReconciliation";
import { jwtMiddleware } from "./lib/localAuth";

const app: Express = express();

// Replit terminates public traffic at an internal proxy. Trust only private proxy
// hops so Express derives req.ip from the proxy-appended client address instead
// of accepting an arbitrary X-Forwarded-For value from an untrusted peer.
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// MyFatoorah calls this route without Clerk authentication. The HMAC signature
// is mandatory and verified before any invoice state is changed.
app.post(
  "/api/myfatoorah/webhook",
  express.json({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["myfatoorah-signature"];
    if (typeof signature !== "string") {
      res.status(400).json({ error: "Missing myfatoorah-signature header" });
      return;
    }
    try {
      const payload = req.body as PaymentWebhook;
      if (!verifyMyFatoorahWebhook(payload, signature)) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
      await reconcileInvoicePayment(payload);
      res.status(200).json({ received: true });
    } catch (err) {
      req.log.error({ err }, "MyFatoorah webhook processing failed");
      res.status(400).json({ error: "Webhook processing failed" });
    }
  },
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(jwtMiddleware);

app.use("/api", router);

export default app;
