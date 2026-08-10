require("dotenv").config();
const { generateChatReply, embedText } = require("../config/gemini");

async function main() {
  console.log("\n--- Test Gemini Chat Model ---");
  const reply = await generateChatReply(
    "Bạn là ai?",
    "Bạn là trợ lý AI hỗ trợ khách hàng tìm và đặt tour du lịch. Trả lời trong 1 câu ngắn."
  );
  console.log("Phản hồi:", reply);

  console.log("\n--- Test Gemini Embedding Model ---");
  const vector = await embedText("Tour Hạ Long 3 ngày 2 đêm, ngân sách 5 triệu");
  console.log("Số chiều vector:", vector.length);

  console.log("\n✔ Môi trường Gemini đã sẵn sàng.\n");
}

main().catch((err) => {
  console.error("✘ Test Gemini thất bại:", err.message);
  process.exit(1);
});
