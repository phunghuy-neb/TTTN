require("dotenv").config();
const { connectMongo } = require("../config/db");
const { getRagContext } = require("../services/ragService");

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    console.error('Cách dùng: npm run query:test -- "Tôi muốn đi biển 3 ngày, ngân sách 5 triệu"');
    process.exit(1);
  }

  await connectMongo();

  console.log(`\nCâu hỏi: "${prompt}"`);
  const { intent, tours } = await getRagContext(prompt);

  console.log("Ý định trích xuất:", intent);
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

  process.exit(0);
}

main().catch((err) => {
  console.error("Thất bại:", err);
  process.exit(1);
});
