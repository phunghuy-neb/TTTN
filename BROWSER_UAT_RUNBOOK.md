# Browser UAT Runbook

## Phạm vi an toàn

UAT dùng riêng:

- MongoDB: `127.0.0.1:27018/vietvoyage_browser_uat`, replica set `uatrs`.
- Chroma container: `vietvoyage-uat-chroma`, collection `tour_vectors_browser_uat`.
- Runtime/log: `C:\TTTN\.uat` (đã ignore khỏi Git).

Không chạy UAT bằng `docker compose --profile ai up`: các `.env` hiện tại của stack chuẩn trỏ tới Mongo dùng chung. Helper UAT sẽ từ chối chạy nếu stack Compose chuẩn còn active.

## Start hệ thống

1. Mở Docker Desktop và chờ engine sẵn sàng.
2. Trong PowerShell:

```powershell
Set-Location C:\TTTN
docker compose --profile ai stop
powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 start
powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 status
```

Kết quả sẵn sàng cần có:

```text
PORT 27018/8000/4000/5000/5173: LISTENING
AI: healthy
Mongo: healthy
Chroma: reachable
Index: healthy
Fallback active: False
```

## URL và tài khoản

- Login: `http://127.0.0.1:5173/login`
- Trợ lý đầy đủ: `http://127.0.0.1:5173/ai-assistant`
- Tài khoản case thông thường: `browser-uat@example.test` / `BrowserUAT123!`
- Tài khoản pagination: `browser-uat-pagination@example.test` / `BrowserUAT123!`

Fixture có 7 tour published, mỗi tour có ba departure tương đối theo ngày chạy seed. Tài khoản pagination có 35 conversations và conversation đầu có 130 messages.

## Health/capability

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health | ConvertTo-Json -Depth 8
Invoke-WebRequest http://127.0.0.1:5000/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5173/ai-assistant -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8000/api/v2/heartbeat -UseBasicParsing
```

Diễn giải AI health:

- `status=healthy`: capability chính sẵn sàng.
- `mongo.status=healthy`: AI đọc đúng Mongo UAT.
- `chroma.status=reachable`: Chroma kết nối được.
- `index.status=healthy`: Mongo/Chroma không split-brain; số document khớp fixture.
- `provider.status=configured`: provider có cấu hình; success/failure thực tế được cập nhật khi gọi.
- `fallback.active=true` hoặc top-level `degraded`: ghi nhận degraded, không coi false-green.

## Xem log

Mở hai PowerShell riêng:

```powershell
Get-Content C:\TTTN\.uat\logs\backend.stdout.log -Tail 100 -Wait
```

```powershell
Get-Content C:\TTTN\.uat\logs\ai.stdout.log -Tail 100 -Wait
```

Log lỗi riêng:

```powershell
Get-Content C:\TTTN\.uat\logs\backend.stderr.log -Tail 100 -Wait
Get-Content C:\TTTN\.uat\logs\ai.stderr.log -Tail 100 -Wait
```

Per-turn trace chi tiết nằm trong Backend với prefix `[chat.turn.trace]`. AI log chủ yếu ghi startup, provider/index và reconciliation; observability của AI được trả về Backend, validate, persist và emit trong logical-turn trace.

Trace đã bật bằng `CHAT_TRACE_LOGGING=true` và có:

- request/client/logical/conversation identity, history epoch, turn sequence, user hash;
- previous state, extracted delta, merged state;
- action/reason/pending clarification;
- RAG filters/mode/candidate IDs/ranking/evidence;
- factual grounding, provider/fallback, validation;
- lifecycle/persistence/final response summary.

Prompt, history, raw spans, token, credential và định danh user trực tiếp không được log.

## Tìm requestId/logicalTurnId

1. Browser DevTools > Network > chọn `POST /api/chat`.
2. Trong response lấy `requestId`, `clientMessageId`, `conversation._id`, `turnSequence`, `historyEpoch` và `decision.action`.
3. Tìm trace:

```powershell
$traceId = '<requestId-hoặc-logicalTurnId>'
Select-String `
  -Path C:\TTTN\.uat\logs\backend.stdout.log `
  -Pattern $traceId `
  -Context 0,100
```

Nếu cần tìm theo conversation:

```powershell
$conversationId = '<conversationId>'
Select-String `
  -Path C:\TTTN\.uat\logs\backend.stdout.log `
  -Pattern $conversationId `
  -Context 0,100
```

Khi gửi log lỗi, không copy cookie, `Authorization`, API key hoặc toàn bộ request body có dữ liệu riêng tư.

## Reset dữ liệu UAT

Reset chỉ drop database local có tên chính xác `vietvoyage_browser_uat`, recreate đúng container `vietvoyage-uat-chroma`, seed lại fixture rồi start stack:

```powershell
Set-Location C:\TTTN
powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 reset
```

Script seed có guard và từ chối mọi Mongo host/database ngoài `127.0.0.1:27018/vietvoyage_browser_uat`. Không dùng reset này cho production/shared data.

## Mô phỏng AI failure an toàn

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 fail-ai
```

Chạy CASE 16, sau đó phục hồi:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 start
powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 status
```

## Dừng hệ thống an toàn

```powershell
Set-Location C:\TTTN
powershell -ExecutionPolicy Bypass -File .\scripts\browser-uat.ps1 stop
```

Lệnh chỉ dừng PID được UAT ghi nhận và container có đúng tên `vietvoyage-uat-chroma`; không xóa dữ liệu. Dùng action `start` để chạy lại hoặc `reset` để tạo fixture sạch.
