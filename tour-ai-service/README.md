# tour-ai-service — Tuần 2

Môi trường Node.js cho phần AI (RAG) của hệ thống đặt tour du lịch.
Nhiệm vụ tuần 2: **thiết lập môi trường + tích hợp Gemini API + script chuyển tour thành vector.**

## 1. Cài đặt

```bash
npm install
cp .env.example .env
```

Điền vào `.env`:
- `MONGO_URI` — chuỗi kết nối MongoDB (đã có sẵn dữ liệu Tour từ collection thiết kế tuần 1).
- `GEMINI_API_KEY` — lấy tại https://aistudio.google.com/app/apikey
- `CHROMA_URL` — địa chỉ Chroma server. Chạy local bằng Docker:

> **Lưu ý:** Project dùng SDK chính thức hiện hành `@google/genai` (SDK cũ `@google/generative-ai` đã ngừng phát triển) với model chat `gemini-3.5-flash` và model embedding `gemini-embedding-001`. Nếu sau này thấy lỗi 404 "model no longer available", nghĩa là Google đã đổi tên model — chỉ cần sửa `GEMINI_CHAT_MODEL` / `GEMINI_EMBEDDING_MODEL` trong `.env`, không cần sửa code.
  ```bash
  docker run -p 8000:8000 chromadb/chroma
  ```

## 2. Kiểm tra môi trường

```bash
npm run test:gemini
```
Nếu thấy dòng `✔ Môi trường Gemini API đã sẵn sàng.` nghĩa là API key và model đã đúng.

## 3. Đồng bộ dữ liệu tour thành vector

```bash
npm run sync:vectors
```
Script sẽ:
1. Lấy các tour `status: published` chưa được đồng bộ.
2. Tách mỗi tour thành các chunk (overview / itinerary / policy).
3. Gọi Gemini Embedding API sinh vector cho từng chunk.
4. Lưu vào ChromaDB, đồng thời đánh dấu `vectorSync.isSynced = true` trong MongoDB.

Chạy lại toàn bộ (kể cả tour đã sync): `npm run sync:vectors -- --force`

## 4. Test truy vấn semantic search

```bash
npm run query:test -- "Tôi muốn đi biển 3 ngày, ngân sách 5 triệu"
```

## Cấu trúc thư mục

```
src/
├── config/
│   ├── db.js          # Kết nối MongoDB
│   ├── gemini.js       # Client Gemini (chat + embedding)
│   └── chroma.js       # Client ChromaDB
├── models/
│   └── Tour.js         # Schema Tour (kế thừa từ báo cáo tuần 1)
├── utils/
│   └── tourChunking.js # Logic tách tour thành chunk văn bản
└── scripts/
    ├── testGemini.js       # Test nhanh kết nối Gemini
    ├── syncTourVectors.js  # Script chính: tour -> vector -> ChromaDB
    └── testQuery.js        # Test semantic search sau khi sync
```

## Việc cần làm tiếp (Tuần 3)

- Viết API nhận prompt người dùng → trả về context (hoàn thiện luồng RAG).
- Ghép nối `testQuery.js` vào một endpoint Express thực tế.
