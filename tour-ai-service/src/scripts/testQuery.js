require("dotenv").config();
const { connectMongo } = require("../config/db");
const { analyzeConversation } = require("../services/conversationEngine");
const { getRagContext } = require("../services/ragService");

/**
 * Kiểm thử nhanh khả năng phân tích hội thoại + truy hồi, KHÔNG qua HTTP.
 * Cách dùng: npm run query:test -- "Tôi muốn đi biển 3 ngày, ngân sách 5 triệu"
 * Có thể truyền nhiều câu cách nhau bởi dấu "|" để mô phỏng nhiều lượt chat:
 *   npm run query:test -- "tôi muốn đi du lịch" "|" "đi biển, ngân sách 5 triệu"
 */
async function main() {
  const rawArgs = process.argv.slice(2).join(" ");
  const turns = rawArgs
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!turns.length) {
    console.error('Cách dùng: npm run query:test -- "Tôi muốn đi biển 3 ngày, ngân sách 5 triệu"');
    process.exit(1);
  }

  await connectMongo();

  const history = [];
  for (const turn of turns) {
    history.push({ role: "user", text: turn });
    console.log(`\nKhách hàng: "${turn}"`);

    const decision = await analyzeConversation(history);
    console.log("Quyết định:", {
      readyToRecommend: decision.readyToRecommend,
      maxPrice: decision.maxPrice,
      region: decision.region,
      days: decision.days,
      softPreferences: decision.softPreferences,
    });

    if (!decision.readyToRecommend) {
      console.log(`Trợ lý (hỏi lại): ${decision.clarifyingQuestion}`);
      history.push({ role: "assistant", text: decision.clarifyingQuestion });
      continue;
    }

    const { tours } = await getRagContext(decision.searchQuery, decision);
    console.log("Kết quả liên quan nhất:");
    if (!tours.length) {
      console.log("  (không tìm thấy tour phù hợp)");
    } else {
      tours.forEach((t, i) => {
        console.log(
          `  #${i + 1} (tourId: ${t._id}) — ${t.name}, giá ${t.basePrice.toLocaleString("vi-VN")}đ, ${t.days} ngày`
        );
      });
    }
    history.push({ role: "assistant", text: "(đã tư vấn)" });
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Thất bại:", err);
  process.exit(1);
});
