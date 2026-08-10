require("dotenv").config();
const { connectMongo } = require("../config/db");
const { syncTourVectors } = require("../services/syncService");

async function main() {
  await connectMongo();

  const force = process.argv.includes("--force");
  console.log(`[Sync] Bắt đầu đồng bộ vector${force ? " (force = toàn bộ)" : ""}...`);

  const result = await syncTourVectors({ force });

  console.log(`[Sync] Tìm thấy ${result.total} tour cần đồng bộ vector.`);
  for (const d of result.details) {
    if (d.status === "synced") {
      console.log(`  ✔ Đã đồng bộ: ${d.name} (${d.chunks} chunk)`);
    } else if (d.status === "error") {
      console.log(`  ✘ Lỗi tour ${d.tourId}: ${d.error}`);
    } else {
      console.log(`  - Bỏ qua tour ${d.tourId}: ${d.reason}`);
    }
  }

  console.log(`[Sync] Hoàn tất. Thành công: ${result.success}. Lỗi: ${result.failed}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[Sync] Thất bại:", err);
  process.exit(1);
});
