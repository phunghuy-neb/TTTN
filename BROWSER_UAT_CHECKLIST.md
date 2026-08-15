# Browser UAT Checklist

## Chuẩn bị chung

1. Chạy `powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 status`; chỉ bắt đầu khi các cổng đều `LISTENING`, AI/Mongo/Index `healthy`, Chroma `reachable`.
2. Mở `http://127.0.0.1:5173/login`, đăng nhập `browser-uat@example.test` / `BrowserUAT123!`, rồi mở `http://127.0.0.1:5173/ai-assistant`.
3. Mở DevTools > Network, bật `Preserve log`. Với mỗi lỗi, giữ lại `requestId`, `clientMessageId`, `conversation._id`, `decision.action` từ response `POST /api/chat`. Không chụp cookie hoặc token.
4. Trừ khi case yêu cầu dùng lịch sử, bấm **Chat mới** trước khi bắt đầu.

## CASE 1 — Recommendation bình thường

- **Steps:** Chat mới, gửi đúng input một lần, chờ cards tải xong.
- **Input:** `tôi muốn đi chơi thứ 6 tuần sau, 4 triệu cho 2 người, chưa biết đi đâu`
- **Expected result:** Không hỏi lại destination/preference; action là `SEARCH`; recommendation hợp lý với ngày/ngân sách/số người; cards có tên, giá và link đúng.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp toàn màn hình và response `POST /api/chat`; lưu request/logical/conversation ID, action, candidate IDs và thời điểm lỗi.

## CASE 2 — Open destination

- **Steps:** Chat mới, gửi input.
- **Input:** `đi đâu cũng được, gợi ý cho tôi tour 3 ngày`
- **Expected result:** Action `SEARCH`; không hỏi “muốn đi đâu?”; có recommendation/cards tour 3 ngày.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp câu hỏi thừa/cards và copy các ID, action, semantic destination, candidate IDs trong Network response.

## CASE 3 — Correction

- **Steps:** Chat mới, gửi input; sau đó gửi `gợi ý tour 3 ngày`.
- **Input:** `2 người, à 3 người`
- **Expected result:** Giá trị cuối là 3, không còn constraint 2 người; recommendation/availability tiếp theo dùng party size 3.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp reply và response của cả hai turn; lưu logical turn IDs và `conversation.constraintState` nếu có trong response.

## CASE 4 — Negation

- **Steps:** Chat mới, gửi input; tiếp tục `gợi ý tour 3 ngày`.
- **Input:** `không muốn đi biển`
- **Expected result:** “Biển” là exclusion, không thành positive preference; kết quả ưu tiên tour không biển hoặc giải thích rõ nếu inventory hạn chế.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp cards/reply và copy semantic exclusions, ranking evidence, candidate IDs cùng các trace ID.

## CASE 5 — Typed clarification

- **Steps:** Chat mới; gửi input đầu; khi AI hỏi scope ngân sách, trả lời ngắn `tổng cho cả đoàn`.
- **Input:** `gợi ý tour 4 triệu`
- **Expected result:** Chỉ hỏi một lần “tổng hay mỗi người”; clarification có slot `budget.scope`; câu trả lời ngắn được consume, pending slot được clear và luồng tiếp tục `SEARCH`, không hỏi vòng lặp.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp cả hai turn; copy decision/clarification của từng response, entity pending clarification và các logical turn IDs.

## CASE 6 — Ordinal

- **Steps:** Chat mới; gửi `đi đâu cũng được, gợi ý 3 tour 3 ngày`; ghi lại A/B/C; gửi input.
- **Input:** `tour thứ 2`
- **Expected result:** Resolve đúng B; text/card/link đều mang ID của B, không phải A/C.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp list A/B/C và reply ordinal; copy `candidateListId`, `tourIds`, referenced tour IDs và conversation ID.

## CASE 7 — Historical ordinal

- **Steps:** Tạo List 1 A/B/C bằng tour 3 ngày; tạo List 2 D/E/F bằng `gợi ý 3 tour 2 ngày`; gửi input.
- **Input:** `tour thứ 2 lúc nãy`
- **Expected result:** Resolve B; nếu context thực sự mơ hồ thì hỏi clarification gắn list cụ thể; tuyệt đối không silently chọn E.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp hai list và reply; copy cả hai `candidateListId`, tour IDs, referenced IDs và action.

## CASE 8 — Reload

- **Steps:** Tạo recommendation 3 cards; ghi tên tour thứ 2; nhấn F5; chờ history tải; gửi `tour thứ 2`.
- **Input:** `tour thứ 2`
- **Expected result:** Text, cards và conversation được reconstruct; ordinal vẫn resolve đúng tour thứ 2 trước reload.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp trước/sau reload; copy API messages pagination, candidate list, missing card IDs và ordinal response.

## CASE 9 — Đổi ngày

- **Steps:** Chọn một tour có ít nhất hai departure; ghi ngày/giá/chỗ của ngày X; đổi sang ngày Y khác được fixture cung cấp.
- **Input:** `đổi sang ngày [ngày Y]`
- **Expected result:** Price và availability được rehydrate theo Y; filter/rank/display cùng basis Y; không giữ fact của X.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp giá/chỗ trước và sau; copy selected tour ID, departure ID/date, factual grounding và action của turn đổi ngày.

## CASE 10 — Đổi số người

- **Steps:** Dùng `gợi ý tour 2 ngày cho 2 người vào thứ 6 tuần sau`; chọn card còn 2–3 chỗ; sau đó gửi input.
- **Input:** `đổi thành 4 người`
- **Expected result:** Availability tính lại cho 4; nếu chỉ còn 2–3 chỗ phải báo không đủ cho đoàn, không dùng kết quả party size 2.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp slots và reply trước/sau; copy party composition, departure grounding, tour ID và logical turn ID.

## CASE 11 — Mixed intent

- **Steps:** Tạo list 3 tour; gửi input trong cùng conversation.
- **Input:** `tour thứ 2 còn chỗ không và chính sách hủy thế nào?`
- **Expected result:** Trả lời cả availability và cancellation policy của đúng tour thứ 2; không route thành cancel command, không bỏ một vế.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp reply; copy action/structured content, referenced tour ID, grounding evidence và booking/tour routing metadata.

## CASE 12 — Conversation switching

- **Steps:** Tạo Conversation A với `ưu tiên Đà Lạt, 2 người`; tạo Conversation B với `không đi biển, 4 người`; chuyển A → B → A và tiếp tục `gợi ý tour 3 ngày` ở mỗi conversation.
- **Input:** Như steps.
- **Expected result:** Mỗi conversation giữ đúng state/history riêng; cards và ordinal không lẫn context.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp sidebar và hai conversation; copy hai conversation IDs, state/action của turn sai và timestamps.

## CASE 13 — History pagination

- **Steps:** Đăng xuất; đăng nhập `browser-uat-pagination@example.test` / `BrowserUAT123!`; mở `Pagination fixture 01`; tải tin cũ; bấm **Tải thêm** ở conversation list.
- **Input:** Không gửi message mới.
- **Expected result:** Load đủ 130 messages (100 + 30) và access đủ 35 conversations (20 + 15); không silently truncate.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp nút/load state; copy response pagination `total`, `page`, `hasMore`, số item thực nhận và request URL.

## CASE 14 — Multi-tab

- **Steps:** Đăng nhập lại tài khoản chính; mở cùng một conversation ở hai tab; gần đồng thời gửi A ở tab 1 và B ở tab 2; reload cả hai rồi hỏi `tóm tắt yêu cầu hiện tại`.
- **Input:** Tab 1: `ngân sách tối đa 5 triệu`; Tab 2: `đi 4 người`.
- **Expected result:** State cuối giữ cả budget và travelers; mỗi logical input chỉ có một user + một assistant message; không mất update hoặc duplicate sai.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp hai tab; copy hai request/logical turn IDs, một conversation ID, turn sequences, history epoch và final merged state.

## CASE 15 — Retry

- **Steps:** Gửi một message; trong DevTools Network dùng **Replay XHR** cho đúng `POST /api/chat` thêm 4 lần nếu browser hỗ trợ. Không sửa body/header và không tạo logical ID mới.
- **Input:** `gợi ý tour 3 ngày`
- **Expected result:** Năm request cùng `clientMessageId` chỉ tạo đúng một user turn và một assistant turn; response retry trả cùng logical result.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL  [ ] NOT RUN (browser không hỗ trợ replay)`
- **Nếu FAIL:** Chụp history duplicate; copy toàn bộ request IDs, một clientMessageId/logicalTurnId, conversation ID và response status từng retry.

## CASE 16 — Error UI

- **Steps:** Ở PowerShell chạy `powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 fail-ai`; gửi input; sau khi ghi nhận UI, chạy lại action `start` để phục hồi.
- **Input:** `gợi ý tour 3 ngày`
- **Expected result:** UI hiển thị typed infrastructure/AI unavailable error có thể retry; không giả thành “không có tour”, thiếu preference hoặc clarification.
- **PASS / FAIL:** `[ ] PASS  [ ] FAIL`
- **Nếu FAIL:** Chụp error UI và Network response; copy HTTP status, error `code/source/retryable`, requestId và backend log cùng thời điểm.
