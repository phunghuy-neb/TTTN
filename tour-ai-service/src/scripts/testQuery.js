/**
 * Script kiểm tra truy vấn ngữ nghĩa sau khi đã chạy syncTourVectors.js.
 * Dùng để xác nhận: nhập một câu hỏi tự nhiên -> nhận về tour liên quan nhất.
 * Chạy: npm run query:test
 */
require('dotenv').config();
const { embedText } = require('../config/gemini');
const { getTourCollection } = require('../config/chroma');

const SAMPLE_QUERY = process.argv[2] || 'Tôi muốn đi biển 3 ngày, ngân sách khoảng 5 triệu';

async function main() {
  const collection = await getTourCollection();
  const queryEmbedding = await embedText(SAMPLE_QUERY);

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: 3,
  });

  console.log(`Câu hỏi: "${SAMPLE_QUERY}"\n`);
  console.log('Kết quả liên quan nhất:');
  results.documents[0].forEach((doc, i) => {
    console.log(`\n#${i + 1} (tourId: ${results.metadatas[0][i].tourId})`);
    console.log(doc);
  });
}

main().catch((err) => {
  console.error('✘ Lỗi truy vấn:', err.message);
  process.exit(1);
});
