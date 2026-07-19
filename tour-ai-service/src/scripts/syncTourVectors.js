/**
 * SCRIPT: syncTourVectors.js
 * ---------------------------------
 * Nhiệm vụ Tuần 2: "viết script chuyển đổi dữ liệu tour thành Vector"
 *
 * Quy trình:
 *  1. Kết nối MongoDB, lấy các tour có status = 'published'
 *     và chưa đồng bộ (vectorSync.isSynced = false) — hoặc dùng --force để chạy lại toàn bộ.
 *  2. Với mỗi tour: tách thành các chunk văn bản (overview / itinerary / policy).
 *  3. Gọi Gemini Embedding API để sinh vector cho từng chunk.
 *  4. Upsert (id, vector, document, metadata) vào ChromaDB.
 *  5. Cập nhật lại tour.vectorSync trong MongoDB để đánh dấu đã đồng bộ.
 *
 * Chạy: npm run sync:vectors
 *       npm run sync:vectors -- --force   (đồng bộ lại toàn bộ, kể cả đã sync)
 */

require('dotenv').config();
const { connectDB } = require('../config/db');
const { embedBatch } = require('../config/gemini');
const { getTourCollection } = require('../config/chroma');
const Tour = require('../models/Tour');
const { buildChunksFromTour, buildMetadata } = require('../utils/tourChunking');

const FORCE_RESYNC = process.argv.includes('--force');

async function run() {
  await connectDB();
  const collection = await getTourCollection();

  const query = FORCE_RESYNC
    ? { status: 'published' }
    : { status: 'published', 'vectorSync.isSynced': { $ne: true } };

  const tours = await Tour.find(query);
  console.log(`[Sync] Tìm thấy ${tours.length} tour cần đồng bộ vector.`);

  if (tours.length === 0) {
    console.log('[Sync] Không có tour nào cần xử lý. Kết thúc.');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const tour of tours) {
    try {
      const chunks = buildChunksFromTour(tour);
      const ids = chunks.map((c) => c.id);
      const documents = chunks.map((c) => c.text);
      const metadatas = chunks.map((c) => buildMetadata(tour, c.type));

      const embeddings = await embedBatch(documents);

      await collection.upsert({ ids, embeddings, documents, metadatas });

      tour.vectorSync = {
        isSynced: true,
        lastSyncedAt: new Date(),
        chromaId: `${tour._id}_overview`, // chunk đại diện để tra cứu ngược
      };
      await tour.save();

      successCount += 1;
      console.log(`  ✔ Đã đồng bộ: ${tour.name} (${chunks.length} chunk)`);
    } catch (err) {
      failCount += 1;
      console.error(`  ✘ Lỗi khi xử lý tour "${tour.name}":`, err.message);
    }
  }

  console.log(`\n[Sync] Hoàn tất. Thành công: ${successCount}. Lỗi: ${failCount}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Sync] Lỗi không mong muốn:', err);
    process.exit(1);
  });
