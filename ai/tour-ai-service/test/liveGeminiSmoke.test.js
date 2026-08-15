const test = require("node:test");
const assert = require("node:assert/strict");

test("gated live Gemini smoke dataset (5 cases)", { skip: process.env.RUN_LIVE_GEMINI_SMOKE !== "1" }, async () => {
  const mongoose = require("mongoose");
  const { connectMongo } = require("../src/config/db");
  const { generateChatAnswer } = require("../src/services/chatService");
  await connectMongo();
  try {
    const cases = [
      "Xin chào",
      "VietVoyage có gì nổi bật?",
      "Tìm tour biển 4 ngày dưới 6 triệu",
      "Tour Đà Lạt có gì hay?",
      "Tour Đà Lạt có khách sạn nào?",
    ];
    for (const prompt of cases) {
      const result = await generateChatAnswer({ prompt });
      assert.ok(result.reply, prompt);
      assert.ok(result.intent?.requestType, prompt);
    }
  } finally {
    await mongoose.disconnect();
  }
});
