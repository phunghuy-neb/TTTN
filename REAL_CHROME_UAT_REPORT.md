# REAL CHROME UAT REPORT

- Thời gian chạy: 2026-08-14, Asia/Bangkok.
- Browser: Chrome thật qua browser extension, tài khoản local UAT `browser-uat@example.test`.
- URL chính: `http://127.0.0.1:5173/ai-assistant`.
- Data scope: Mongo `127.0.0.1:27018/vietvoyage_browser_uat`, Chroma `tour_vectors_browser_uat`.
- Phạm vi: TEST + TRACE + REPORT. Không sửa code, không thay credential, không dùng production data.
- Tổng browser turns quan sát: 19; Gemini: 1; deterministic/provider-skipped: 18; browser fallback: 0.

## REAL CHROME UAT RESULT

| Hạng mục | Kết quả |
| --- | --- |
| Chrome automation | PASS - thao tác qua UI Chrome thật, login UAT, tạo chat mới, gửi message và đọc UI thực |
| System health | PASS |
| Phase 9B core behaviors | PARTIAL - phần lớn routing/state/entity fixes hoạt động, nhưng hard exclusion `biển` vẫn sai ở retrieval evidence |
| Gemini Mode A | FAIL về grounding - provider gọi thành công nhưng validation chấp nhận mô tả không có trong dữ liệu |
| Mode B forced failure | PASS ở safe isolated service simulation; không phải browser turn |
| Mode C deterministic | PASS |
| Candidate/UI ID consistency | PASS - 0 mismatch trên 19 turns |
| Verdict | **FAIL** |

Không được diễn giải verdict này thành production-ready.

## A. PRECHECK

| Component | Evidence | Result |
| --- | --- | --- |
| Frontend | Port 5173 LISTENING; `GET /ai-assistant` = 200 | UP |
| Backend | Port 5000 LISTENING; `GET /` = 200 | UP |
| AI service | Port 4000 LISTENING; `/health.status=healthy` | UP |
| Mongo | `capabilities.mongo.status=healthy`, 7 published/active tours, 7 vector-synced tours | HEALTHY |
| Chroma | `capabilities.chroma.status=reachable`, 21 documents | HEALTHY |
| Vector index | `status=healthy`, 7 indexed tours, expected=21, actual=21, reconciliation not needed | HEALTHY |
| Provider config | `provider.status=configured`, model `gemini-3.5-flash`, embedding `gemini-embedding-001` | CONFIGURED |
| Provider gating | Không có disable/bypass flag; browser Mode A sau đó thực sự gọi provider | ENABLED |
| Fallback capability | available, `active=false` trước test | AVAILABLE |

### Live Gemini probe

Precheck probe trực tiếp thực hiện request thật tới Gemini, không chỉ đọc health:

- Provider: Gemini.
- Model: `gemini-3.5-flash`.
- Result: HTTP/provider `503 UNAVAILABLE` - `This model is currently experiencing high demand`.
- Latency: khoảng 5,631 ms.
- Trạng thái ngay sau precheck probe: **GEMINI_CONFIGURED_BUT_FAILED**.

Sau đó Mode A trên Chrome thành công:

- Request/logical turn: `379a206c-180e-469a-a87a-97d78e388a74` / `9d412ea4-f644-438d-ac44-754f6bfe0f55`.
- Provider status: `healthy`; validation: `accepted`; fallback: false.
- End-to-end ChatTurn latency: 8,357 ms.
- Provider health sau request: `status=healthy`, `lastSuccessAt=2026-08-14T14:55:46.509Z`.
- Trạng thái cuối phiên: **GEMINI_LIVE**.

## Candidate ID map

| ID | Tour |
| --- | --- |
| `000000000000000000000001` | Vịnh Hạ Long - Kỳ quan trên biển |
| `000000000000000000000002` | Sa Pa - Săn mây trên đỉnh Fansipan |
| `000000000000000000000004` | Phong Nha - Vương quốc hang động |
| `000000000000000000000005` | Huế - Dấu ấn cố đô vàng son |
| `000000000000000000000006` | Hội An - Phố cổ đèn lồng lung linh |
| `000000000000000000000007` | Đà Lạt - Thành phố ngàn hoa mộng mơ |

## B-P. Per-turn browser trace

`Gemini A/S` = provider attempted/provider succeeded. Model chỉ áp dụng khi provider attempted. `Selected` dùng referenced/persisted entity khi response không expose `selectedEntity` trực tiếp.

| Test | Input | UI output / semantic result | Action / reason | Candidate list / candidate IDs | Selected | Gemini A/S; fallback | Source / final composer | Request ID / logicalTurnId | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | `gợi ý tour nhưng đừng cho tôi Đà Lạt` | State: destination removed; excluded=`Đà Lạt`. UI: Hội An, Hạ Long, Huế; không có Đà Lạt. Copy mở đầu generic `Theo yêu cầu hiện tại...`. | SEARCH / `recommendation_actionable` | `candidates:0:1:71bf7a1d-9886-4982-8f54-94c798290e85`; `[006,001,005]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `818b5474-1675-4812-8e85-1de156c04e66` / `71bf7a1d-9886-4982-8f54-94c798290e85` | MINOR |
| T2 | `tôi muốn đi tối đa 3 ngày` | State duration=`max/3`, destination unknown. UI có ba tour đều 3 ngày; không có tour >3 ngày. | SEARCH / `recommendation_actionable` | `candidates:0:1:097c2cf4-9609-40e6-8368-898bc2a86673`; `[006,007,004]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `7fbef74c-fee2-4fa4-981e-1bd3b8143004` / `097c2cf4-9609-40e6-8368-898bc2a86673` | PASS |
| T3 | `hai đứa có tầm 8 củ, đi đâu vui vui 3 hôm cũng được` | State: travelers=2, budget=`approximate/unspecified/8m`, duration=3, destination intentionally open. UI text và cards cùng Sa Pa, Hội An, Đà Lạt. | SEARCH / `recommendation_actionable` | `candidates:0:1:40ac80d0-0f74-4609-8e58-1ac50b085667`; `[002,006,007]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `d7457af2-4e64-406d-98ac-63f5106a3d3a` / `40ac80d0-0f74-4609-8e58-1ac50b085667` | PASS |
| T4.1 | `gợi ý tour khoảng 8 triệu cho 2 người, đi đâu cũng được` | State: travelers=2, total budget approx 8m, destination open. UI: Sa Pa, Hội An, Đà Lạt. | SEARCH / `recommendation_actionable` | `candidates:0:1:b282855a-e70e-4218-87af-f6ca52a80a7a`; `[002,006,007]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `5b82e7a5-cf11-473b-9399-bbda9b314d27` / `b282855a-e70e-4218-87af-f6ca52a80a7a` | PASS |
| T4.2 | `tôi không muốn đi biển` | Semantic state giữ hard exclusion `biển`, nhưng UI vẫn đề xuất Hội An; itinerary Hội An có `Biển An Bàng` và `tắm biển An Bàng`. Trace evidence ghi `matched=false`. | SEARCH / `recommendation_actionable` | Reused list `candidates:0:1:b282855a-e70e-4218-87af-f6ca52a80a7a`; `[002,006,007]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `f985bcbc-31ab-4219-8ee9-9dda7d62de56` / `f27439fc-db0c-4280-9e6e-3ccf6f0a08ef` | **FAIL** |
| T4.3 | `à đổi thành 3 người` | State cuối: travelers=3, total budget 8m còn giữ, excluded interest=`biển` còn giữ; không booking. UI vẫn chứa Hội An. | SEARCH / `recommendation_actionable` | `candidates:0:3:a263d0de-0e07-470a-ab31-4a9dfe5a5e0d`; `[005,007,006]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `b0e296e3-8407-46ce-977c-a9d1c5385cda` / `a263d0de-0e07-470a-ab31-4a9dfe5a5e0d` | **FAIL** |
| T5 | `muốn đi khoảng 3 ngày` | Duration update=`approximate/3`; ranking chọn toàn tour 3 ngày. Tuy nhiên retained hard exclusion `biển` vẫn không loại Hội An. | SEARCH / `recommendation_actionable` | `candidates:0:4:1077586d-a03c-45f0-b69d-a5cd5a3761a1`; `[007,006,002]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `02742d83-2e0c-4d0c-9c20-4204b8818ca1` / `1077586d-a03c-45f0-b69d-a5cd5a3761a1` | **FAIL** |
| T6.1 | `tour thứ 2` | Không search lại. UI trả detail Hội An, đúng candidate #2 của list T5. | ANSWER / `tour_entity_resolved` | Referenced `[006]`; source list T5 | `006` Hội An | No/N/A; false | DETERMINISTIC / `buildTourDetail` | `02597ab7-9ad2-44c6-b8bd-c26b8dd0bcd1` / `95fbb69b-7fbb-4bbf-8bd7-738f7573fd56` | PASS |
| T6.2 | `tour đó giá bao nhiêu và còn đủ cho 3 người không?` | Giữ Hội An; giá base 3.600.000đ; departures còn 10/12/4 chỗ và đều đủ cho 3. Không hỏi chọn lại. | ANSWER / `mixed_read_only_facts` | Referenced `[006]` | `006` Hội An | No/N/A; false | DETERMINISTIC / `buildMixedTourFacts` | `08b89253-3981-40af-bc13-13e7976d5f05` / `8530f330-a932-4012-b74c-06f5d69002e7` | PASS |
| T7.1 | `nếu đổi thành 4 người thì sao?` | travelers=4; availability rehydrated cho cùng Hội An; không booking lookup. | ANSWER / `entity_facts_rehydrated_after_constraint_update` | Referenced `[006]` | `006` Hội An | No/N/A; false | DETERMINISTIC / `buildMixedTourFacts` | `9e22c8ed-f1fc-4019-9a04-bd72f42d83fc` / `2c637405-2f43-46e2-b220-c1f388589fba` | PASS |
| T7.2 | `vậy đổi tiêu chí thành tối đa 3 ngày đi` | duration=`max/3`; route SEARCH, không booking. UI có Huế, Hội An, Phong Nha; duration đúng nhưng Hội An vẫn vi phạm retained `biển`. | SEARCH / `recommendation_actionable` | `candidates:0:8:b76d3106-eeb7-481b-8560-0b28c15c6e91`; `[005,006,004]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `5eab9387-d654-4f73-83eb-200e9cd529a6` / `b76d3106-eeb7-481b-8560-0b28c15c6e91` | **FAIL** |
| T8.1 | `cho tôi danh sách khác` | List mới thực sự khác: Đà Lạt, Sa Pa; không lặp active list `[005,006,004]`. | SEARCH / `alternative_results_requested` | New `candidates:0:9:818c5690-b419-4c72-836d-0b9af045237a`; `[007,002]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `4c2580f1-9b0b-4248-844d-9e6afd998edc` / `818c5690-b419-4c72-836d-0b9af045237a` | PASS |
| T8.2 | `tour thứ 2 lúc nãy thì sao?` | UI resolve Hội An, tức #2 của list trước alternative `[005,006,004]`, không dùng #2 active list mới là Sa Pa. Persisted final `selectedCandidateListId` vẫn trỏ list T5 (`...seq4`), nên source-list provenance không chứng minh được list T7.2 (`...seq8`) dù entity đúng. | ANSWER / `tour_entity_resolved` | Referenced `[006]` | `006` Hội An | No/N/A; false | DETERMINISTIC / `buildTourDetail` | `e0c67221-08f8-4d3a-8022-eb51fb0ccb07` / `16e97506-46f4-494e-955c-d3e972a12eba` | MINOR |
| T8.3 | `tour đó còn chỗ không và chính sách hủy thế nào?` | Giữ Hội An; trả availability cho 4 và policy hủy đầy đủ; không route cancel booking. | ANSWER / `mixed_read_only_facts` | Referenced `[006]` | `006` Hội An | No/N/A; false | DETERMINISTIC / `buildMixedTourFacts` | `be5f55e2-11b3-426c-8ca6-64ce2d3fd762` / `b394e96f-69da-4f77-a2a8-921e75d6dc24` | PASS |
| Mode A attempt 1 | `Hội An có phù hợp cho người thích chụp ảnh không?` | Không trả lời suitability; biến `Hội An` thành destination và render một recommendation. | SEARCH / `recommendation_actionable` | `candidates:0:1:073ea764-c9b1-49bb-bb07-1322cf5adbdb`; `[006]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `34cb72d4-3394-49a7-81b7-fb27c8591e84` / `073ea764-c9b1-49bb-bb07-1322cf5adbdb` | **FAIL** |
| Mode A attempt 2 | `Trong danh sách vừa gợi ý... hợp người thích chụp ảnh...` | Persisted destination khiến action tiếp tục SEARCH và lặp nguyên recommendation; Gemini vẫn bị bypass. | SEARCH / `recommendation_actionable` | Reused `candidates:0:1:073ea764-c9b1-49bb-bb07-1322cf5adbdb`; `[006]` | - | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `aa4c8170-c8de-444a-8a72-dcf136064a75` / `1890af20-1129-40b6-90bf-235af9cee6a8` | **FAIL** |
| Mode A attempt 3 | Cùng câu hỏi chụp ảnh trên tour page nhưng conversation cũ | Page tour context không thắng persisted recommendation state; tiếp tục SEARCH, provider skipped. | SEARCH / `recommendation_actionable` | Reused list; `[006]` | `006` page context | No/N/A; false | DETERMINISTIC / `buildRecommendationReply` | `c6a85d33-e4cf-4087-8d54-f84dd5537bff` / `d1e088a9-233d-4fda-a9ca-c64c14130f62` | **FAIL** |
| Mode A clean | Cùng câu hỏi chụp ảnh, chat mới sạch trên page Hội An | UI trả đoạn tư vấn dài và card Hội An. Trace: RAG `mongo_only`, direct/hydrated/selected `[006]`, provider healthy, validation accepted. Text thêm `hàng nghìn chiếc đèn lồng` và `biển An Bàng lộng gió`, không có trong fixture. | ANSWER / `general_request` | `candidates:0:1:9d412ea4-f644-438d-ac44-754f6bfe0f55`; `[006]` | `006` page context | Yes/Yes; false; `gemini-3.5-flash` | GEMINI / `generateChatReply`; deterministic validation accepted; reply persisted unchanged | `379a206c-180e-469a-a87a-97d78e388a74` / `9d412ea4-f644-438d-ac44-754f6bfe0f55` | **FAIL** |
| Mode C | `xin chào` | UI greeting ngắn, không cards. 29 ms. | ANSWER / `deterministic_conversation` | none | - | No/N/A; false | DETERMINISTIC / `conversationalReply` | `560f3d29-bce4-4268-8b6a-c53a7b31bd2d` / `09d69eee-f6e1-4f04-ba97-49f024fe505f` | PASS |

## Main test result

| Test | Result | Kết luận |
| --- | --- | --- |
| TEST 1 - excluded destination | MINOR | Exclusion Đà Lạt đúng; copy generic |
| TEST 2 - max duration | PASS | `MAX=3`, không destination=`tối đa`, không tour >3 ngày |
| TEST 3 - natural/slang | PASS | 2 người, ~8m, 3 ngày, destination open, SEARCH; text/cards consistent |
| TEST 4 - multi-turn state | FAIL | State và routing giữ đúng, nhưng hard exclusion `biển` không được retrieval thực thi với Hội An |
| TEST 5 - duration refinement | FAIL | Duration refinement đúng; full retained constraint set vẫn sai vì Hội An lọt hard exclusion |
| TEST 6 - ordinal + anaphora | PASS | Candidate #2 và follow-up entity/price/availability đúng |
| TEST 7 - update not booking | FAIL | Không booking hijack, nhưng recommendation sau criteria update vẫn vi phạm retained hard exclusion |
| TEST 8 - alternative + history | MINOR | Behavior/entity đúng; source candidate-list provenance không rõ do persisted selected list trỏ list cũ hơn |

## Mode A - Gemini pipeline

Request thành công chỉ đạt được khi tạo chat sạch trên tour detail page. Pipeline thực tế:

1. Chrome widget gửi page context Hội An (`tourId=006`).
2. Backend tạo/persist `ChatTurn`, requestId/logicalTurnId như bảng.
3. Semantic delta rỗng; action policy chọn `ANSWER/general_answer`.
4. RAG `mongo_only`, direct entity `[006]`, grounding price basis base 3.600.000đ.
5. `generateWithProvider()` gọi Gemini model `gemini-3.5-flash`.
6. Gemini sinh **toàn bộ natural-language `reply`**, không chỉ một đoạn phụ.
7. `validateGeneratedReply()` trả `accepted`.
8. Không có deterministic re-composition của text; backend persist reply, frontend render Markdown. Structured tour card được dựng deterministic từ hydrated tour.

Mode A không PASS vì generated text có claim không nằm trong Mongo/RAG context:

- `hàng nghìn chiếc đèn lồng` - fixture chỉ nói phố đèn lồng, không có số lượng.
- `biển An Bàng lộng gió` - fixture chỉ nói tắm biển/thư giãn, không có dữ liệu thời tiết/gió.

First wrong component: Gemini generation tạo unsupported embellishment; safeguard đầu tiên thất bại là `validateGeneratedReply`, vì trace ghi `validation.status=accepted` và final text được persist/render nguyên trạng.

## Mode B - forced provider failure

Không có browser-safe runtime switch để ép riêng Gemini 429 mà không tác động credential/process thật. Đã dùng safe isolated Node process, monkey-patch provider chỉ trong process test, không sửa file hoặc credential.

Simulation result:

- providerAttempted=true.
- Simulated error: Gemini 429.
- action=`ANSWER`, reason=`general_request` không đổi.
- candidate IDs trước/sau: `[64b000000000000000000071]` không đổi.
- providerSucceeded=false.
- provider code=`AI_PROVIDER_RATE_LIMITED`.
- fallbackUsed=true.
- response type=`grounded_fallback`.
- final composer=`providerFallbackReply`.
- Fallback chỉ dùng grounded facts: tên, 4 ngày, 5.500.000đ; không invent khách sạn/máy bay/policy.

Mode B: PASS ở service isolation. Browser turns fallback vẫn là 0.

## Mode C - deterministic response

- Input: `xin chào`.
- responseSource=`DETERMINISTIC`.
- finalComposer=`conversationalReply`.
- providerAttempted=false; provider status=`skipped`; fallback=false.
- Không retrieval, không cards, không Gemini.

## Logic failures

### 1. Hard exclusion `biển` không loại tour có beach itinerary

Reproduction:

1. Chat mới: `gợi ý tour khoảng 8 triệu cho 2 người, đi đâu cũng được`.
2. Gửi: `tôi không muốn đi biển`.
3. Semantic state đúng: `interests.excludedValues=["biển"]`, exclusion hard.
4. UI/structured/cards vẫn chứa Hội An (`006`).
5. Mongo fixture Hội An có itinerary `Biển An Bàng - Tiễn khách` và description `tắm biển An Bàng`.
6. Ranking trace cho `006` ghi exclusion `biển`, `matched=false`.

First wrong component: `retrievalEvidenceService.conceptEvidenceText()` chuyển full evidence text sang ASCII, sau đó `semanticPhraseEvidence()` coi single-word ASCII `bien` là ambiguous và không cho ASCII fallback. Vì vậy chuỗi thật `Biển An Bàng` bị miss. Direct isolated evaluation trên current code/tour `006` cũng trả `matched=false` dù evidence text chứa `Biển An Bàng`.

Impact: TEST 4, TEST 5 và criteria-search của TEST 7 vi phạm hard constraint; đây là logic/retrieval failure, không phải copy issue.

### 2. General destination question bị SEARCH hijack

`Hội An có phù hợp cho người thích chụp ảnh không?` bị semantic extraction biến `Hội An` thành positive destination, sau đó action policy chọn SEARCH. UI không trả lời câu hỏi suitability và Gemini không được gọi. Persisted destination tiếp tục làm hai follow-up bị bypass. Chỉ chat sạch + page tour context mới vào `general_answer`.

First wrong component: semantic/action boundary - destination delta được ưu tiên như recommendation intent dù câu hỏi là general evaluation về entity.

## Context failures

- State retention cho budget/travelers/non-beach hoạt động; booking không hijack.
- Failure nằm ở việc retrieval không áp dụng retained `biển`, không phải semantic merge.
- Historical ordinal trả đúng Hội An, nhưng persisted `selectedCandidateListId` cuối trỏ list T5 (`candidates:0:4:...`) thay vì list ngay trước alternative T7.2 (`candidates:0:8:...`). Vì hai list đều có Hội An ở vị trí #2, UI đúng nhưng provenance source-list không chứng minh được. Mark MINOR.

## Grounding/fact failures

- Gemini Mode A thêm hai descriptive claims không có trong hydrated Mongo/RAG data; validation vẫn accepted.
- Không thấy sai price/availability/cancellation trong deterministic T6-T8.
- Hội An beach itinerary bị retrieval evidence bỏ sót là factual evidence coverage failure.

## Booking-routing failures

Không tái hiện booking hijack:

- `à đổi thành 3 người` -> SEARCH.
- `nếu đổi thành 4 người thì sao?` -> ANSWER/mixed facts cho selected tour.
- `vậy đổi tiêu chí thành tối đa 3 ngày đi` -> SEARCH.
- Availability + cancellation policy không route thành cancel booking command.

## UI/response consistency

Đã kiểm tra programmatically 19 browser turns:

- Với mọi SEARCH: `TRACE_CANDIDATES == STRUCTURED_CANDIDATES == CARD_CANDIDATES`.
- Text chứa đúng tên của mọi structured candidate.
- Không có ANSWER kèm recommendation cards vô cớ; Mode A ANSWER có một grounded card của chính page entity.
- T6/T8 follow-up đều reference Hội An (`006`), không nhảy A/C.
- Kết quả: 0 ID-set mismatch.

## Copy/UX issues

- T1 dùng `Theo yêu cầu hiện tại, đây là các tour phù hợp nhất` và lặp `Đây là một trong các tour đang hoạt động gần yêu cầu nhất...` mà không nêu evidence cụ thể. MINOR.
- Intro `Vì bạn đang để mở điểm đến...` lặp qua nhiều refinement turns; phần reasons phía dưới có evidence, nhưng nhịp copy còn máy móc. MINOR.
- Không thấy câu `Các hướng nới hợp lý là nới ngân sách.`.
- Không thấy format lỗi `4.000.000đ cho 2`; các turn dùng `cho 2 người`/`cho 3 người`/`cho 4 người`.
- Tour-context Mode A render card base price 3.600.000đ trong khi page đang hiển thị departure gần nhất 3.950.000đ; trace xác định card dùng base price, nhưng UI card không gắn nhãn `từ`, có thể gây hiểu nhầm. MINOR.

## Most important finding

Phase 9B chưa hết lỗi trên Chrome thật: hard exclusion `biển` được parse và persist đúng nhưng bị mất hiệu lực tại retrieval evidence, nên tour Hội An có itinerary biển vẫn được recommend. Đồng thời Gemini có tạo user-visible final text thật, nhưng current validation không ngăn được unsupported descriptive embellishments.

## Is Gemini actually generating user-visible answers?

**PARTIALLY**.

- YES cho một browser turn `ANSWER/general_answer`: Gemini tạo toàn bộ final natural-language reply; deterministic code chỉ cung cấp RAG context, validate, persist và dựng structured card.
- NO cho 18/19 browser turns còn lại: provider bị skip; `buildRecommendationReply`, `buildTourDetail`, `buildMixedTourFacts` hoặc `conversationalReply` tạo final text.
- Browser fallback turns: 0. Forced 429 fallback chỉ chạy trong safe isolated service simulation.

## Final verdict

**FAIL**.

Chrome automation và phần lớn Phase 9B routing/entity fixes hoạt động, nhưng còn một hard-constraint retrieval bug, một general-question routing bug và một Gemini validation/grounding gap. Dừng tại report; không sửa code trong lượt này.
