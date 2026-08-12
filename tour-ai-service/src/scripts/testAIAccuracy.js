require("dotenv").config();
const { connectMongo } = require("../config/db");
const { converse } = require("../services/chatService");
const sessionService = require("../services/sessionService");

/**
 * Kiểm thử độ chính xác AI (ảo giác, sai lệch thông tin), cập nhật cho luồng
 * hội thoại đa lượt. Mỗi test case là một chuỗi các lượt chat (turns); script
 * kiểm tra 3 loại vấn đề:
 *   1. Lọc cứng sai: tour trả về vi phạm ràng buộc rõ ràng người dùng nêu.
 *   2. Ảo giác số liệu: số tiền AI nhắc tới không khớp basePrice tour nào.
 *   3. Hỏi lại quá dai dẳng: hệ thống hỏi lại quá 1 lần liên tiếp cho cùng
 *      một yêu cầu, khiến hội thoại không bao giờ tới bước tư vấn (vi phạm
 *      quy tắc "không hỏi lại quá 1 lần" trong conversationEngine).
 */

const TEST_CASES = [
  {
    label: "Ràng buộc đầy đủ ngay từ đầu",
    turns: ["Tôi muốn đi biển 3 ngày 2 đêm, ngân sách 5 triệu"],
  },
  {
    label: "Ràng buộc rõ về khu vực",
    turns: ["Có tour nào ở Miền Bắc dưới 4 triệu không?"],
  },
  {
    label: "Mơ hồ lúc đầu, làm rõ ở lượt sau (kỳ vọng: hỏi lại đúng 1 lần rồi tư vấn)",
    turns: ["Tôi muốn đi du lịch", "Đi biển thôi, ngân sách khoảng 5 triệu"],
  },
  {
    label: "Mơ hồ và không cung cấp thêm (kỳ vọng: không hỏi lại quá 1 lần)",
    turns: ["Tôi muốn đi du lịch", "Sao cũng được, bạn gợi ý đại đi"],
  },
];

function extractMoneyLikeNumbers(text) {
  const matches = text.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,}/g) || [];
  return matches.map((m) => Number(m.replace(/[.,]/g, ""))).filter((n) => n >= 100000);
}

async function runCase(testCase) {
  const sessionId = sessionService.createSessionId();
  const issues = [];
  let clarifyCount = 0;
  let lastResult = null;

  for (const turn of testCase.turns) {
    lastResult = await converse(sessionId, turn);
    if (lastResult.clarifying) clarifyCount += 1;
  }

  if (clarifyCount > 1) {
    issues.push(`Hỏi lại ${clarifyCount} lần trong cùng một hội thoại (vượt giới hạn 1 lần)`);
  }

  if (!lastResult.clarifying) {
    const { intent, tours, reply } = lastResult;

    if (typeof intent.maxPrice === "number") {
      const violating = tours.filter((t) => t.basePrice > intent.maxPrice);
      if (violating.length) {
        issues.push(`Lọc cứng sai: ${violating.length} tour vượt ngân sách ${intent.maxPrice.toLocaleString("vi-VN")}đ`);
      }
    }

    const validPrices = new Set(tours.map((t) => t.basePrice));
    const suspicious = extractMoneyLikeNumbers(reply).filter((n) => !validPrices.has(n));
    if (tours.length && suspicious.length) {
      issues.push(`Nghi vấn ảo giác số liệu: [${suspicious.join(", ")}] không khớp basePrice tour nào trong context`);
    }
  }

  return { ...testCase, clarifyCount, lastResult, issues };
}

async function main() {
  await connectMongo();
  console.log("=== Kiểm thử độ chính xác AI (hội thoại đa lượt) ===\n");
  let totalIssues = 0;

  for (const testCase of TEST_CASES) {
    const result = await runCase(testCase);
    console.log(`• ${result.label}`);
    result.turns.forEach((t) => console.log(`  Khách hàng: "${t}"`));
    console.log(`  Số lần AI hỏi lại: ${result.clarifyCount}`);
    console.log(`  Trạng thái cuối: ${result.lastResult.clarifying ? "vẫn đang hỏi lại" : `đã tư vấn (${result.lastResult.tours.length} tour)`}`);
    console.log(`  Trả lời cuối: ${result.lastResult.reply.slice(0, 200)}${result.lastResult.reply.length > 200 ? "..." : ""}`);

    if (result.issues.length) {
      totalIssues += result.issues.length;
      result.issues.forEach((i) => console.log(`  ⚠ ${i}`));
    } else {
      console.log("  ✔ Không phát hiện dấu hiệu bất thường");
    }
    console.log("");
  }

  console.log(
    totalIssues === 0
      ? "=== Hoàn tất: không phát hiện vấn đề nào. ==="
      : `=== Hoàn tất: phát hiện ${totalIssues} vấn đề cần xem lại. ===`
  );
  process.exit(totalIssues === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Kiểm thử thất bại:", err);
  process.exit(1);
});
