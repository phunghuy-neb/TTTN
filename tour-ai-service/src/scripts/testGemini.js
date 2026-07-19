/**
 * Script kiểm tra nhanh: Gemini API key có hoạt động không,
 * cả chat model lẫn embedding model.
 * Chạy: npm run test:gemini
 */
require('dotenv').config();
const { generateChatReply, embedText } = require('../config/gemini');

async function main() {
  console.log('--- Test Gemini Chat Model ---');
  const reply = await generateChatReply(
    'Trả lời ngắn gọn 1 câu: bạn là trợ lý AI cho hệ thống đặt tour du lịch.'
  );
  console.log('Phản hồi:', reply);

  console.log('\n--- Test Gemini Embedding Model ---');
  const vector = await embedText('Tour Hạ Long 3 ngày 2 đêm, giá 5 triệu.');
  console.log('Số chiều vector:', vector.length);
  console.log('5 giá trị đầu:', vector.slice(0, 5));

  console.log('\n✔ Môi trường Gemini API đã sẵn sàng.');
}

main().catch((err) => {
  console.error('✘ Lỗi kết nối Gemini API:', err.message);
  process.exit(1);
});
