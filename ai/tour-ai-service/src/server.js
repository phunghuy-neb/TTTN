require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { connectMongo } = require("./config/db");
const aiRoutes = require("./routes/aiRoutes");

async function main() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // AI service chỉ dành cho Backend chính. Health check được mở cho Docker;
  // mọi endpoint gọi Gemini/Chroma đều cần shared key và rate limit.
  const hits = new Map();
  const cleanupHits = setInterval(() => {
    const now = Date.now();
    for (const [key, item] of hits) if (item.resetAt <= now) hits.delete(key);
  }, 5 * 60_000);
  cleanupHits.unref();
  app.use("/api/ai", (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let item = hits.get(key);
    if (!item || item.resetAt <= now) item = { count: 0, resetAt: now + 60_000 };
    item.count += 1;
    hits.set(key, item);
    if (item.count > (Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 60)) {
      return res.status(429).json({ error: "Quá giới hạn gọi AI" });
    }

    const configured = String(process.env.AI_INTERNAL_API_KEY || "");
    const received = String(req.get("x-internal-api-key") || "");
    const a = Buffer.from(configured);
    const b = Buffer.from(received);
    if (!configured || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "AI service yêu cầu internal API key" });
    }
    next();
  });

  // /health nằm ở root để load balancer/deploy platform kiểm tra dễ dàng,
  // đồng thời cũng có ở /api/ai/health cho tiện gọi cùng nhóm route AI.
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use("/api/ai", aiRoutes);

  await connectMongo();

  const port = process.env.AI_SERVICE_PORT || 4000;
  app.listen(port, () => {
    console.log(`[tour-ai-service] Đang chạy tại http://localhost:${port}`);
    console.log(`  - POST /api/ai/context`);
    console.log(`  - POST /api/ai/chat`);
    console.log(`  - POST /api/ai/chat/stream`);
    console.log(`  - POST /api/ai/sync-vectors`);
    console.log(`  - GET  /api/ai/health`);
  });
}

main().catch((err) => {
  console.error("[tour-ai-service] Khởi động thất bại:", err);
  process.exit(1);
});
