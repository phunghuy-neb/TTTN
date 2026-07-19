# PROJECT.md — TTTN: Website đặt tour du lịch tích hợp AI trợ lý (RAG)

> **File này là nguồn sự thật DUY NHẤT của dự án.**
> Mọi luật lệ, ràng buộc, phân công và cấu hình cho agent (Claude Code / Codex CLI) đều nằm ở đây.
> `CLAUDE.md` và `AGENTS.md` được **sinh tự động** từ file này — không sửa tay.

**Đề tài:** Website đặt tour du lịch tích hợp AI trợ lý (RAG).
**Loại:** Đồ án thực tập tốt nghiệp — **Nhóm 1**.
**Mô tả:** Nền tảng cho phép người dùng khám phá, tìm kiếm và đặt tour du lịch trực tuyến; tích hợp trợ lý AI dùng kỹ thuật RAG (Retrieval-Augmented Generation) để tư vấn tour, trả lời câu hỏi và hỗ trợ đặt chỗ theo thời gian thực (streaming). Thanh toán online qua VNPay/MoMo với xác thực chữ ký IPN ở backend.

---

## 1. Mandatory Rules For Claude Code And Codex CLI

Các luật BẮT BUỘC dưới đây áp dụng cho mọi agent làm việc trên repo:

1. **`PROJECT.md` là file luật DUY NHẤT.** Mọi quy tắc, ràng buộc, phân công đều lấy từ đây. Nếu có mâu thuẫn ở bất kỳ nguồn nào khác, `PROJECT.md` thắng.
2. **KHÔNG sửa tay `CLAUDE.md` và `AGENTS.md`.** Hai file này do `sync.py` sinh ra từ `PROJECT.md`. Muốn đổi luật → sửa `PROJECT.md` rồi chạy `python sync.py`.
3. **Đọc `PROJECT.md` + `.claude/handoff.md` TRƯỚC khi đổi bất kỳ dòng code nào.** Nắm luật và bối cảnh bàn giao trước khi hành động.
4. **Sau khi đổi code Frontend, PHẢI chạy `cd frontend && npm run build`** để bảo đảm build không lỗi trước khi kết thúc task.
5. **KHÔNG đọc/sửa `.env`, `node_modules/`, `dist/`.** Đây là vùng cấm (bí mật / sinh tự động / phụ thuộc).
6. **Cập nhật `.claude/handoff.md` sau MỖI task** để phiên/agent kế tiếp biết trạng thái, việc đã làm và việc còn dang dở.
7. **Xin duyệt trước** khi cài package, chạy global installer, hoặc chạm vào `.env` (xem mục *Machine Setup Policy*).
8. **Không tạo file rác ở root** (`*_REPORT.md`, `PLAN.md`, `TODO.md`…) trừ khi user yêu cầu (xem *File Creation Policy*).

---

## 2. Current Status

- **Repo:** https://github.com/phunghuy-neb/TTTN.git
- **Nhánh làm việc:** `fe` (Frontend Client).
- **Cấu trúc thư mục chính:**
  - `frontend/` — React + Vite + Tailwind CSS (giao diện người dùng cuối).
  - `backend/` — Node.js + Express (API, auth, thanh toán, admin).
  - `ai-server/` — Python + ChromaDB + Gemini, streaming qua Socket.io (RAG).
- **Lệnh cơ bản:**
  - Cài đặt FE: `cd frontend && npm install`
  - Dev FE: `cd frontend && npm run dev`
  - Build FE: `cd frontend && npm run build`
- **Tham chiếu giao diện:** file **`app.html`** ở gốc repo là **NGUỒN THAM CHIẾU GIAO DIỆN DUY NHẤT** cho Frontend (màu, font, layout).

---

## 3. Phân công thành viên

| Thành viên | Vai trò / Phần phụ trách |
|---|---|
| **Mai Tuấn Anh** | AI Server / RAG (`ai-server/`) |
| **Phùng Bá Huy** (chủ repo) | Frontend Client (`frontend/`) + đặc tả use case + kiểm thử UI/UX |
| **Phạm Trung Kiên** | Backend (`backend/`) + Admin Dashboard |

---

## 4. Current Stack

| Lớp | Công nghệ |
|---|---|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| AI Server | Python + ChromaDB + Gemini, streaming Socket.io |
| Cơ sở dữ liệu | MongoDB + ChromaDB |
| Xác thực | JWT + bcrypt |
| Thanh toán | VNPay / MoMo (Webhook IPN xác thực chữ ký ở backend) |

**Ràng buộc công nghệ:**
- **KHÔNG dùng Next.js.** Frontend là React + Vite thuần.
- **KHÔNG thêm UI library ngoài** (MUI, Ant Design, Chakra, Bootstrap…) trừ khi user yêu cầu rõ ràng. Giao diện dựng bằng Tailwind CSS bám theo `app.html`.

---

## 5. Design Tokens

Design token bám **khớp `app.html`** — không được đổi nếu chưa được duyệt.

| Token | Giá trị |
|---|---|
| Font body | **Be Vietnam Pro** |
| Font heading | **Lora** |
| Màu chính (teal) | `#0D4A45` |
| Màu jade | `#1E8A6E` |
| Màu coral (nhấn) | `#EF6A47` |
| Màu nền (bg) | `#FBFAF6` |
| Bo tròn nút | `999px` (pill) |
| Bo góc thành phần | `16px` |

> ⚠️ **KHÔNG thay đổi** font, bảng màu, bo góc nếu chưa được user/nhóm duyệt.

---

## 6. Protected Fixes (bất biến — không được phá vỡ)

Những điểm sau là **ràng buộc bảo vệ**; mọi thay đổi FE phải giữ nguyên chúng:

1. **Giao diện phải khớp `app.html`** (màu, font, layout, spacing).
2. **Mọi lời gọi dữ liệu phải đi qua tầng `services/`** — kể cả dữ liệu mock. Không gọi `fetch`/`axios` trực tiếp rải rác trong component.
3. **Giữ nguyên cấu trúc router:**
   `/`, `/tour/:id`, `/login`, `/register`, `/profile`, `/checkout`, `/payment`, `/bookings`.
4. **Validate form đầy đủ:**
   - Email đúng định dạng.
   - Mật khẩu **≥ 6 ký tự**.
   - Số điện thoại theo mẫu `0\d{9}` (bắt đầu bằng 0, đủ 10 chữ số).
5. **Giữ nguyên menu chính** — *Trang chủ / Khám phá tour / Ưu đãi / Liên hệ* — và **widget chat AI nổi** (floating) ở giao diện.

---

## 7. File Creation Policy

- **CẤM tạo** `*_REPORT.md`, `PLAN.md`, `TODO.md` (và các file tài liệu rác tương tự) ở **thư mục gốc** repo — **trừ khi user yêu cầu**.
- Tài liệu bàn giao dùng chung nằm ở `.claude/handoff.md`.
- Không tạo file thừa "cho có"; chỉ tạo file phục vụ trực tiếp task được giao.

---

## 8. Spec Kit Governance

- **CHỈ dùng Spec Kit** cho: **feature lớn**, **thay đổi API-schema**, hoặc **major UI flow**.
- **KHÔNG dùng Spec Kit** cho hotfix nhỏ, sửa lỗi giao diện lặt vặt, đổi text/label, tinh chỉnh style.
- Mục tiêu: giữ quy trình nhẹ, tránh thủ tục rườm rà cho việc nhỏ.

---

## 9. Machine Setup Policy

Agent **PHẢI xin duyệt trước** khi:
- Chạy `npm install` (thêm/gỡ dependency).
- Chạy bất kỳ **global installer** nào (`npm i -g`, `pip install`, cài binary hệ thống…).
- Đọc hoặc sửa file **`.env`** / biến môi trường / secrets.

Không tự ý thay đổi môi trường máy hay phụ thuộc dự án khi chưa được đồng ý.

---

## 10. Common Commands

```bash
# Frontend
cd frontend && npm install      # cài phụ thuộc (cần xin duyệt trước)
cd frontend && npm run dev       # chạy dev server
cd frontend && npm run build     # build production (BẮT BUỘC chạy sau khi đổi code FE)

# Đồng bộ luật cho agent (sau khi sửa PROJECT.md)
python sync.py                   # sinh lại CLAUDE.md + AGENTS.md, mirror skills

# Git
git checkout fe                  # làm việc trên nhánh fe
git status
```

---

## 11. Session End Checklist

Trước khi kết thúc phiên làm việc, agent kiểm tra:

- [ ] Đã cập nhật `.claude/handoff.md` với trạng thái & việc còn dang dở?
- [ ] Nếu đổi code FE → đã chạy `cd frontend && npm run build` và build **không lỗi**?
- [ ] Nếu đã **sửa `PROJECT.md`** → đã chạy **`python sync.py`** để sinh lại `CLAUDE.md` + `AGENTS.md`?
- [ ] Không tạo file rác ở root, không đụng vào `.env` / `node_modules` / `dist`?
- [ ] Thay đổi vẫn giữ nguyên các *Protected Fixes* (router, services/, validate, menu, chat AI, khớp `app.html`)?
