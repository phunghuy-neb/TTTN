const mongoose = require('mongoose');

async function connectDB() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong file .env');
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[MongoDB] Đã kết nối:', mongoose.connection.name);
  return mongoose.connection;
}

module.exports = { connectDB };
