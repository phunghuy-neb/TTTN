require("dotenv").config();
const { connectMongo } = require("../config/db");
const { generateChatAnswer } = require("../services/chatService");

/**
 * Tuần 6 — "Kiểm thử độ chính xác của AI (ảo giác, sai lệch thông tin)."
 *
 * Đây không phải unit test hình thức mà là bộ kiểm thử theo kịch bản thực tế,
 * kiểm tra 2 loại lỗi phổ biến của hệ thống RAG:
 *   1. Lọc cứng sai: tour trả về vi phạm ràng buộc rõ ràng người dùng nêu
 *      (VD: ngân sách 5 triệu nhưng trả tour 8 triệu).
 *   2. Ảo giác số liệu: số tiền AI nhắc tới trong câu trả lời không khớp với
 *      basePrice thật của bất kỳ tour nào được trả về (dấu hiệu AI tự bịa giá
 *      thay vì lấy từ context).
 *
 * Đây là kiểm thử heuristic (dò tìm dấu hiệu bất thường), không thay thế cho
 * việc con người đọc lại câu trả lời, nhưng giúp phát hiện sớm lỗi hệ thống.
 */

const TEST_CASES = [
  {
    label: "Ràng buộc đầy đủ (ngân sách + số ngày)",
    prompt: "Tôi muốn đi biển 3 ngày 2 đêm, ngân sách 5 triệu",
  },
  {
    label: "Ràng buộc rõ về khu vực",
    prompt: "Có tour nào ở Miền Bắc dưới 4 triệu không?",
  },
  {
    label: "Prompt mơ hồ, không ràng buộc rõ ràng",
    prompt: "Gợi ý cho tôi một tour hay",
  },
];

/** Trích các con số trông giống số tiền VNĐ trong một đoạn text (heuristic đơn giản). */
function extractMoneyLikeNumbers(text) {
  const matches = text.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,}/g) || [];
  return matches
    .map((m) => Number(m.replace(/[.,]/g, "")))
    .filter((n) => n >= 100000); // bỏ số nhỏ không có ý nghĩa tiền tệ
}

async function runCase(testCase) {
  const { reply, intent, tours } = await generateChatAnswer(testCase.prompt);

  const issues = [];

  // Kiểm tra 1: lọc cứng ngân sách
  if (typeof intent.maxPrice === "number") {
    const violating = tours.filter((t) => t.basePrice > intent.maxPrice);
    if (violating.length) {
      issues.push(
        `Lọc cứng sai: ${violating.length} tour vượt ngân sách ${intent.maxPrice.toLocaleString("vi-VN")}đ`
      );
    }
  }

  // Kiểm tra 2: ảo giác số liệu — số tiền trong reply có khớp basePrice tour nào không
  const validPrices = new Set(tours.map((t) => t.basePrice));
  const mentionedNumbers = extractMoneyLikeNumbers(reply);
  const suspicious = mentionedNumbers.filter((n) => !validPrices.has(n));
  if (tours.length && suspicious.length) {
    issues.push(
      `Nghi vấn ảo giác số liệu: các số [${suspicious.join(", ")}] không khớp basePrice của tour nào trong context`
    );
  }

  return { ...testCase, intent, tourCount: tours.length, reply, issues };
}

async function main() {
  await connectMongo();

  console.log("=== Kiểm thử độ chính xác AI ===\n");
  let totalIssues = 0;

  for (const testCase of TEST_CASES) {
    const result = await runCase(testCase);
    console.log(`• ${result.label}`);
    console.log(`  Prompt: "${result.prompt}"`);
    console.log(`  Intent: ${JSON.stringify(result.intent)}`);
    console.log(`  Số tour trả về: ${result.tourCount}`);
    console.log(`  Trả lời: ${result.reply.slice(0, 200)}${result.reply.length > 200 ? "..." : ""}`);

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
