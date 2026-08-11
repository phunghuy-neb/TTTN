require("dotenv").config();
const express = require("express");
const { connectMongo } = require("./config/db");
const aiRoutes = require("./routes/aiRoutes");

async function main() {
  const app = express();
  app.use(express.json());

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
