

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
    │   ├── sessionService.js    (lưu lịch sử hội thoại theo session)
    │   ├── conversationEngine.js (phân tích cả hội thoại - hỏi lại hay tư vấn)
    │   ├── ragService.js        (truy hồi dữ liệu tour - RAG)
    │   ├── chatService.js       (điều phối hội thoại + streaming)
    │   └── syncService.js       (đồng bộ vector - dùng chung script/API)
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
| 3 | Hoàn thiện luồng RAG (semantic search + lọc cứng, ghép context). | `services/ragService.js`, `scripts/testQuery.js` |
| 4 | Đưa AI vào luồng chat thực tế (`/api/ai/chat`), xử lý streaming text (`/api/ai/chat/stream` qua SSE). | `services/chatService.js`, `routes/aiRoutes.js` |
| 5 | Giao diện Chatbot trên Client, tích hợp TTS (Text-to-Speech, dùng Web Speech API trình duyệt) để AI đọc phản hồi. | `client-widget/ChatbotWidget.jsx` |
| 6 | Kiểm thử độ chính xác AI (phát hiện lọc cứng sai + ảo giác số liệu), deploy hệ thống AI (Docker). | `scripts/testAIAccuracy.js`, `Dockerfile`, `docker-compose.yml` |

## Vì sao đây không chỉ là "bộ lọc có giao diện chat"

Nếu chỉ trích xuất ràng buộc (giá/khu vực/số ngày) từ MỖI câu riêng lẻ rồi lọc,
hệ thống thực chất là một form filter được gõ bằng ngôn ngữ tự nhiên — không có
gì khác biệt về bản chất so với việc bấm dropdown chọn giá/khu vực.

Điểm khác biệt được thêm vào ở đây là **hội thoại đa lượt có trạng thái**:

- `sessionService.js` giữ lịch sử hội thoại theo `sessionId`, không xử lý mỗi
  câu độc lập.
- `conversationEngine.js` đọc **toàn bộ lịch sử** (không chỉ câu mới nhất) để
  gộp ràng buộc nêu rải rác qua nhiều lượt, và tự quyết định 1 trong 2 hành
  động: **hỏi lại** (khi thông tin chưa đủ để tư vấn có ý nghĩa) hoặc **tư
  vấn** (khi đủ thông tin, hoặc người dùng đã không muốn cung cấp thêm). Một
  bộ lọc không có khái niệm "chưa đủ dữ kiện, cần hỏi thêm" — nó luôn trả kết
  quả ngay với input hiện có.
- Khi tư vấn, `chatService.js` yêu cầu mô hình **so sánh và giải thích lý do**
  giữa các tour (system instruction trong `RECOMMEND_SYSTEM_INSTRUCTION`),
  thay vì chỉ liệt kê danh sách trơ như kết quả filter.
- `softPreferences` (sở thích không có field trong DB, ví dụ "ít đông người",
  "phù hợp người lớn tuổi") được gộp vào câu truy vấn ngữ nghĩa, dùng semantic
  search trên ChromaDB để xử lý — filter cứng không làm được việc này vì
  không có field tương ứng.

## Chạy thử

### 1. Cài đặt

```bash
cd tour-ai-service
npm install
cp .env.example .env
# điền GEMINI_API_KEY, MONGO_URI, CHROMA_URL thật vào .env
```

Yêu cầu chạy sẵn: MongoDB (đã có dữ liệu Tour do Backend chính tạo) và ChromaDB
(`docker run -p 8000:8000 chromadb/chroma`).

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
# mô phỏng nhiều lượt hội thoại, cách nhau bởi "|":
npm run query:test -- "Tôi muốn đi du lịch" "|" "Đi biển thôi, ngân sách 5 triệu"
```

### 5. Chạy server AI

```bash
npm run dev
```

Các endpoint:

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/ai/chat` | POST | Nhận `{ sessionId?, message }`, trả về `{ sessionId, reply, tours, clarifying, intent }` (không streaming) |
| `/api/ai/chat/stream` | POST | Giống `/chat` nhưng streaming qua SSE (event: `session`, `chunk`, `done`, `error`) |
| `/api/ai/session/:sessionId` | DELETE | Xóa lịch sử hội thoại, dùng khi user bấm "Cuộc trò chuyện mới" |
| `/api/ai/sync-vectors` | POST | Admin kích hoạt đồng bộ vector thủ công (body tùy chọn `{ force: true }`) |
| `/api/ai/health`, `/health` | GET | Kiểm tra server còn sống |

Field `clarifying` trong response quyết định cách hiển thị: `true` là AI đang
hỏi lại (không có `tours`), `false` là AI đã tư vấn kèm danh sách tour liên quan.

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

`docker-compose.yml` dựng cả `tour-ai-service` và `chromadb` cùng lúc. MongoDB dùng
chung với Backend chính nên trỏ `MONGO_URI` trong `.env` tới instance đã có sẵn
(không dựng thêm trong compose này).

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
| Kết quả trả về lệch ngân sách người dùng nêu | Semantic search thuần túy vẫn xếp hạng cao tour có mô tả giống nhau dù vượt giá | Thêm bước phân tích hội thoại (`conversationEngine`), lọc cứng theo metadata trước khi xếp hạng ngữ nghĩa |
| Xử lý mỗi câu độc lập khiến hệ thống chỉ là "filter có giao diện chat" | Bỏ qua ngữ cảnh các lượt chat trước, không phân biệt được lúc nào cần hỏi thêm | Chuyển sang hội thoại có trạng thái (`sessionService` + `conversationEngine` đọc toàn bộ lịch sử), tự quyết định hỏi lại hay tư vấn |
| Gemini đôi khi trả JSON kèm markdown code fence | Model không luôn tuân thủ tuyệt đối định dạng yêu cầu | Xử lý làm sạch chuỗi trước `JSON.parse`, có try/catch fallback về `null` |
| Nhiều chunk cùng một tour lọt vào top-k | Một tour tách thành nhiều chunk khi embedding | Gom nhóm theo `tourId`, loại trùng trước khi truy vấn MongoDB |
| Độ trễ phản hồi cao khi chờ AI sinh xong toàn bộ câu trả lời | Gọi Gemini generation đồng bộ, không stream | Dùng `generateContentStream` + Server-Sent Events, đẩy từng đoạn text tới client ngay khi sinh ra |
