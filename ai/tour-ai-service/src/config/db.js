const mongoose = require("mongoose");

/**
 * Kết nối tới MongoDB dùng chung với Backend chính (database: tour_booking).
 * AI Service chỉ ĐỌC dữ liệu Tour đã published, không ghi đè nghiệp vụ booking/user.
 */
async function connectMongo() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("Thiếu biến môi trường MONGO_URI trong file .env");
  }

  mongoose.connection.on("connected", () => {
    console.log("[MongoDB] Đã kết nối:", uri);
  });
  mongoose.connection.on("error", (err) => {
    console.error("[MongoDB] Lỗi kết nối:", err.message);
  });

  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = { connectMongo };
