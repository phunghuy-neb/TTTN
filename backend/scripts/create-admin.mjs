import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('Thiếu MONGO_URI trong .env');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Đã kết nối MongoDB.');

  const email = 'admin@example.com';
  const password = 'password123';

  // Check if admin already exists
  let adminUser = await User.findOne({ email });
  if (adminUser) {
    console.log(`Tài khoản ${email} đã tồn tại, đang đặt lại role thành admin...`);
    adminUser.role = 'admin';
    await adminUser.save();
  } else {
    adminUser = new User({
      name: 'Admin User',
      email,
      password,
      role: 'admin',
    });
    await adminUser.save();
    console.log(`Đã tạo tài khoản admin: ${email}`);
  }

  console.log(`✔ Xong! Bạn có thể đăng nhập bằng email: ${email} và mật khẩu: ${password}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Lỗi:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
