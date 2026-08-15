require("dotenv").config();
const express = require("express");
const { connectMongo } = require("./config/db");
const aiRoutes = require("./routes/aiRoutes");
const { createInternalAiGateway } = require("./middleware/internalAiGateway");
const { reconcileTourIndex } = require("./services/syncService");
const { inspectIndexIntegrity, publicCapabilitySnapshot } = require("./services/indexIntegrityService");
const { AI_CHAT_CONTRACT_VERSION } = require("./services/aiContractService");

async function main() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // Root health stays open for deployment probes. Internal AI routes require the shared key.
  app.get("/health", async (req, res) => {
    const snapshot = publicCapabilitySnapshot(await inspectIndexIntegrity());
    res.json({ ...snapshot, contractVersion: AI_CHAT_CONTRACT_VERSION });
  });
  app.use("/api/ai", createInternalAiGateway());
  app.use("/api/ai", aiRoutes);

  await connectMongo();

  const port = process.env.AI_SERVICE_PORT || 4000;
  app.listen(port, () => {
    console.log(`[tour-ai-service] Listening on http://localhost:${port}`);
    console.log("  - POST /api/ai/context");
    console.log("  - POST /api/ai/chat");
    console.log("  - POST /api/ai/chat/stream");
    console.log("  - POST /api/ai/sync-vectors");
    console.log("  - GET  /api/ai/health");
  });

  if (process.env.AUTO_RECONCILE_INDEX !== "false") {
    reconcileTourIndex({ repair: true })
      .then(({ before, recovery, after }) => {
        console.log("[ai.index.reconciliation]", {
          before: before.capabilities.index.status,
          repairedTours: recovery?.success || 0,
          failedTours: recovery?.failed || 0,
          after: after.capabilities.index.status,
        });
      })
      .catch((error) => {
        console.warn("[ai.index.reconciliation.failed]", {
          errorCode: error?.code || null,
          errorName: error?.name || "Error",
        });
      });
  }
}

main().catch((error) => {
  console.error("[tour-ai-service] Startup failed:", error.message);
  process.exit(1);
});
