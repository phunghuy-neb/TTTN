# tour-ai-service

AI Service (RAG pipeline) cho **Hệ thống Quản lý và Đặt tour du lịch tích hợp AI trợ lý**.
Đây là toàn bộ phần việc của **Mai Tuấn Anh** trong đồ án, tổng hợp đủ 6 tuần thành
một kết quả bàn giao hoàn chỉnh, có thể chạy thật.

## Kiến trúc tổng quan

```
User (Client) ──chat──► tour-ai-service ──► Gemini API (chat + embedding)
                              │
                              ├─► ChromaDB   (semantic search: "tour nào liên quan")
                              └─► MongoDB    (dữ liệu chính xác: giá, lịch trình, chính sách)
```

Nguyên tắc cốt lõi xuyên suốt: **ChromaDB chỉ dùng để xác định tour nào liên quan,
còn dữ liệu dùng để trả lời luôn lấy trực tiếp từ MongoDB** — tránh AI trả lời sai
giá hoặc thông tin đã lỗi thời.

## Cấu trúc thư mục

```
tour-ai-service/
├── package.json
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── client-widget/
│   └── ChatbotWidget.jsx      (Tuần 5 - widget chat nhúng vào Client)
└── src/
    ├── config/
    │   ├── db.js               (kết nối MongoDB)
    │   ├── gemini.js           (chat + embedding, SDK @google/genai)
    │   └── chroma.js           (kết nối ChromaDB)
    ├── models/
    │   └── Tour.js             (schema Tour - Tuần 1)
    ├── utils/
    │   └── tourChunking.js     (chiến lược chunking - Tuần 1)
    ├── services/
    │   ├── intentService.js    (trích xuất ý định - Tuần 3)
    │   ├── ragService.js       (luồng RAG 6 bước - Tuần 3)
    │   ├── chatService.js      (sinh câu trả lời + streaming - Tuần 4)
    │   └── syncService.js      (đồng bộ vector - Tuần 2, dùng chung script/API)
    ├── routes/
    │   └── aiRoutes.js         (/api/ai/*)
    ├── scripts/
    │   ├── testGemini.js       (Tuần 2)
    │   ├── syncTourVectors.js  (Tuần 2)
    │   ├── testQuery.js        (Tuần 2)
    │   └── testAIAccuracy.js   (Tuần 6)
    └── server.js
```

## Tổng hợp theo từng tuần

| Tuần | Nội dung | File liên quan |
|---|---|---|
| 1 | Phân tích luồng hoạt động AI (RAG pipeline), thiết kế schema MongoDB (Tour, User, Booking) và thiết kế vector embedding ChromaDB (chunking, cấu trúc document, metadata). | `models/Tour.js`, `utils/tourChunking.js` |
| 2 | Thiết lập môi trường Node.js cho AI (`tour-ai-service`), tích hợp Gemini API (`@google/genai`), viết script chuyển đổi dữ liệu tour thành vector. | `config/gemini.js`, `config/chroma.js`, `services/syncService.js`, `scripts/syncTourVectors.js`, `scripts/testGemini.js` |
| 3 | Hoàn thiện luồng RAG (trích xuất ý định, semantic search, ghép context), API `/api/ai/context`. | `services/intentService.js`, `services/ragService.js`, `routes/aiRoutes.js`, `scripts/testQuery.js` |
| 4 | Đưa AI vào luồng chat thực tế (`/api/ai/chat`), xử lý streaming text (`/api/ai/chat/stream` qua SSE). | `services/chatService.js`, `routes/aiRoutes.js` |
| 5 | Giao diện Chatbot trên Client, tích hợp TTS (Text-to-Speech, dùng Web Speech API trình duyệt) để AI đọc phản hồi. | `client-widget/ChatbotWidget.jsx` |
| 6 | Kiểm thử độ chính xác AI (phát hiện lọc cứng sai + ảo giác số liệu), deploy hệ thống AI (Docker). | `scripts/testAIAccuracy.js`, `Dockerfile`, `docker-compose.yml` |

## Chạy thử

### 1. Cài đặt

```bash
cd tour-ai-service
npm install
cp .env.example .env
# điền GEMINI_API_KEY, MONGO_URI, CHROMA_URL và AI_INTERNAL_API_KEY vào .env
```

Yêu cầu chạy sẵn: MongoDB (đã có dữ liệu Tour do Backend chính tạo) và ChromaDB
(`docker run -p 127.0.0.1:8000:8000 chromadb/chroma`). `AI_INTERNAL_API_KEY` phải là
chuỗi ngẫu nhiên mạnh và trùng `AI_SERVICE_API_KEY` trong `.env` Backend.

### 2. Kiểm thử kết nối Gemini

```bash
npm run test:gemini
```

### 3. Đồng bộ dữ liệu tour thành vector

```bash
npm run sync:vectors
# hoặc đồng bộ lại toàn bộ, kể cả tour đã synced:
npm run sync:vectors -- --force
```

### 4. Kiểm thử truy vấn ngữ nghĩa

```bash
npm run query:test -- "Tôi muốn đi biển 3 ngày, ngân sách 5 triệu"
```

### 5. Chạy server AI

```bash
npm run dev
```

Các endpoint:

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/ai/context` | POST | Nhận `{ prompt, tourContext? }`, trả về context liên quan (chưa sinh câu trả lời) |
| `/api/ai/chat` | POST | Trả về context + câu trả lời tự nhiên (không streaming) |
| `/api/ai/chat/stream` | POST | Giống `/chat` nhưng streaming qua SSE (dùng cho ChatbotWidget) |
| `/api/ai/sync-vectors` | POST | Admin kích hoạt đồng bộ vector thủ công (body tùy chọn `{ force: true }`) |
| `/api/ai/health`, `/health` | GET | Kiểm tra server còn sống |

Mọi endpoint `/api/ai/*` yêu cầu header `x-internal-api-key`; chỉ `/health` ở root
được mở cho health check. FE không gọi trực tiếp service này mà đi qua Backend.

### 6. Kiểm thử độ chính xác AI

```bash
npm run test:accuracy
```

Script chạy một bộ prompt mẫu và dò 2 dấu hiệu lỗi: lọc cứng ngân sách sai, và số
tiền AI nhắc tới không khớp `basePrice` của tour nào trong context (nghi vấn ảo giác).

### 7. Deploy

```bash
docker compose up --build -d
```

`docker-compose.yml` dựng cả `tour-ai-service` và `chromadb` cùng lúc. AI chỉ bind
`127.0.0.1:4000`; ChromaDB chỉ nằm trong mạng Docker, không publish ra host. MongoDB dùng
chung với Backend chính nên trỏ `MONGO_URI` trong `.env` tới instance đã có sẵn
(không dựng thêm trong compose này). Khi MongoDB chạy trên máy host và AI chạy
trong Docker Desktop, dùng `host.docker.internal` thay cho `localhost` trong `MONGO_URI`.

## Tích hợp giao diện Chatbot (Tuần 5)

Nhúng `client-widget/ChatbotWidget.jsx` vào bất kỳ trang nào của Client (Home, Tour
Detail...):

```jsx
import ChatbotWidget from "./ChatbotWidget";

function App() {
  return (
    <>
      {/* ...nội dung trang... */}
      <ChatbotWidget aiServiceUrl="http://localhost:4000" />
    </>
  );
}
```

Widget tự kết nối `/api/ai/chat/stream`, hiển thị câu trả lời chạy chữ theo thời
gian thực, và đọc to câu trả lời bằng giọng nói trình duyệt (nút 🔊/🔇 để bật/tắt).

## Khó khăn gặp phải và hướng xử lý (tổng hợp)

| Khó khăn | Nguyên nhân | Hướng xử lý |
|---|---|---|
| Gemini API báo lỗi 404 model not found | Model `gemini-1.5-flash`/`gemini-2.5-flash` ngừng phục vụ người dùng mới | Chuyển sang SDK `@google/genai` và model GA hiện hành (`gemini-3.5-flash`, `gemini-embedding-001`) |
| Rủi ro lặp lại khi model tiếp tục đổi | Nhà cung cấp AI cập nhật/deprecate model thường xuyên | Tên model lấy từ `.env`, không hard-code trong source |
| Kết quả trả về lệch ngân sách người dùng nêu | Semantic search thuần túy vẫn xếp hạng cao tour có mô tả giống nhau dù vượt giá | Thêm bước trích xuất ý định (`intentService`), lọc cứng theo metadata trước khi xếp hạng ngữ nghĩa |
| Gemini đôi khi trả JSON kèm markdown code fence | Model không luôn tuân thủ tuyệt đối định dạng yêu cầu | Xử lý làm sạch chuỗi trước `JSON.parse`, có try/catch fallback về `null` |
| Nhiều chunk cùng một tour lọt vào top-k | Một tour tách thành nhiều chunk khi embedding | Gom nhóm theo `tourId`, loại trùng trước khi truy vấn MongoDB |
| Độ trễ phản hồi cao khi chờ AI sinh xong toàn bộ câu trả lời | Gọi Gemini generation đồng bộ, không stream | Dùng `generateContentStream` + Server-Sent Events, đẩy từng đoạn text tới client ngay khi sinh ra |
