# FINAL AUDIT MATRIX

## Scope and source mapping

No standalone PASS 1 or PASS 2 finding artifact exists in the repository or current Git tree. The matrix therefore normalizes the root causes from the Phase 1-7 requirements, focused regression names, stress suites, and the four explicit PASS 3 IDs (`AUD3-01` through `AUD3-04`). It does not invent missing original audit IDs.

Allowed status values are used exactly: `FIXED`, `MITIGATED`, `BLOCKED`, `NOT REPRODUCIBLE`, `NOT TESTABLE`.

| ID | Root cause | Phase | Test / reproduction | Status |
|---|---|---:|---|---|
| AUD3-01 / LIF-01 | Concurrent requests saved whole conversation state and allowed last-save-wins lost updates. | 1 | `backend/test/chatTurnLifecycle.test.js` concurrent budget + travelers; Phase 8 concurrent update + clear. | FIXED |
| AUD3-02 / LIF-02 | A retry had no stable logical-turn identity, so the same POST could insert duplicate turns. | 1 | Five retries create one user/assistant pair. | FIXED |
| AUD3-02 / LIF-03 | Client abort did not distinguish transport attempt from logical turn completion. | 1 | Abort then retry reproduction. | FIXED |
| AUD3-03 / LIF-04 | Clear history had no epoch fence, allowing an old in-flight request to resurrect state/messages. | 1 | In-flight request -> clear -> completion; Phase 8 queued concurrent updates + clear. | FIXED |
| AUD3-04 / LIF-05 | Preference extraction persisted before AI success and survived failed chats. | 1 | AI failure after preference preview; invalid AI payload consistency test. | FIXED |
| LIF-06 | Preference, messages, conversation state, and turn status were not one detectable consistency unit. | 1 | Injected persistence failures at five commit boundaries. | FIXED |
| SEM-01 | Flat field/value state could not distinguish unknown, known, open, removed, relaxed, and ambiguous. | 2 | Semantic State V2 status-model tests. | FIXED |
| SEM-02 | Open-ended destination language was treated as missing. | 2 | Open destination tests plus Phase 8 slang/no-diacritics variants. | FIXED |
| SEM-03 | Same-message corrections accumulated stale earlier values. | 2 | Traveler, budget, destination corrections; Phase 8 `khoan/chot` variants. | FIXED |
| SEM-04 | Negation/exclusion spans could become positive interests or destinations. | 2 | Beach/Dalat exclusions plus Phase 8 `khong khoai/ne` variants. | FIXED |
| SEM-05 | Budget values lacked exact/min/max/range/approximate and total/per-person semantics. | 2 | Numeric operator and budget-scope table. | FIXED |
| SEM-06 | Duration values lacked exact/min/max/approximate/optional semantics. | 2 | Duration operator table plus postfixed `khong bat buoc` adversarial test. | FIXED |
| SEM-07 | Traveler composition and child removal left stale child ages/derived totals. | 2 | Child-age composition and removal; Phase 8 `khong dan be theo nua`. | FIXED |
| SEM-08 | Destination state could not preserve origin, multiple values, and exclusions independently. | 2 | Destination projection/exclusion and explicit-destination regressions. | FIXED |
| SEM-09 | Impossible semantic states could silently persist. | 2 | Non-positive travelers, reversed budget, invalid date, stale ages, incompatible totals. | FIXED |
| SEM-10 | Legacy/unsupported fields could remain silently unused. | 2 | Legacy migration and unsupported-version tests; Phase 8 legacy -> correction interaction. | FIXED |
| SEM-11 | One span could be claimed by unrelated extractors, such as budget range and date. | 2 | `3-4 million` span ownership/no-date invariant. | FIXED |
| POL-01 | Clarification/action authority was distributed across parser, orchestration, LLM, and fallback. | 3 | Phase 3 authoritative decision suite. | FIXED |
| POL-02 | Missing optional preferences independently forced clarification. | 3 | Optional-missing actionability tests. | FIXED |
| POL-03 | Intentionally-open destination was routed as required-missing. | 3 | Open-destination SEARCH tests and open + soft-preference interaction. | FIXED |
| POL-04 | Pending typed clarification was not consumed and cleared. | 3 | Budget scope resolution and retry + clarification interaction. | FIXED |
| POL-05 | Bare ordinal answers could not resolve entity-selection clarification. | 3 | Bare `2` entity selection test. | FIXED |
| POL-06 | Fact questions could mutate search constraints like commands. | 3 | Duration fact-vs-command tests. | FIXED |
| POL-07 | Mixed read-only intents were truncated or routed as one mutation. | 3 | Availability + cancellation policy and price + duration tests. | FIXED |
| POL-08 | Any saved preference could suppress a genuinely required clarification. | 3 | Saved-preference/material-ambiguity test. | FIXED |
| POL-09 | LLM/provider fallback could override SEARCH/ANSWER/CLARIFY decided upstream. | 3/7 | SEARCH no-clarification invariant and provider parity tests. | FIXED |
| RAG-01 | Mongo `vectorSync.isSynced` was trusted even when Chroma contained zero documents. | 4 | Empty-index split-brain test. | FIXED |
| RAG-02 | Health could be green while Chroma/index capability was degraded. | 4/8 | Capability health tests for Mongo, Chroma, index, provider, fallback. | FIXED |
| RAG-03 | Empty/missing index had no safe reconciliation strategy. | 4 | Isolated reconciliation rebuild test. | FIXED |
| RAG-04 | Soft preference matching acted like a hard filter and caused false zero-result. | 4 | Soft miss returns all hard-valid candidates. | FIXED |
| RAG-05 | Candidate order index zero was treated as falsy and penalized. | 4 | Candidate index-zero ranking test. | FIXED |
| RAG-06 | Explicit destinations outside a legacy allowlist disappeared before retrieval. | 2/4 | Japan/Singapore/Korea semantic tests; degraded + Singapore interaction. | FIXED |
| RAG-07 | Mongo fallback preselected too narrowly before personalization/ranking. | 4 | Profile targetDays=10 recall test. | FIXED |
| RAG-08 | Unbounded substring matching created false interest evidence. | 4 | Beach vs Bien Hoa/unrelated inland evidence test. | FIXED |
| RAG-09 | Internal retrieval/index failures were presented as invalid user constraints/no results. | 4/7 | Internal-degradation zero-result and typed RAG error tests. | FIXED |
| RAG-10 | Filtering, ranking, and explanation used different evidence. | 4/5 | Shared semantic/factual evidence tests. | FIXED |
| GND-01 | Facts were validated against a union pool instead of the claimed tour entity. | 5 | Cross-tour price/duration/value validation tests. | FIXED |
| GND-02 | Date eligibility used departure price while display/ranking used base price. | 5 | Date-specific filter/rank/display price-basis invariant. | FIXED |
| GND-03 | Availability checked only `slots > 0`, not effective party size. | 5 | One slot vs party two and exact-capacity tests. | FIXED |
| GND-04 | Date, price, and slots could come from different departures. | 5 | Departure X/Y isolation tests. | FIXED |
| GND-05 | Cheaper/savings/better-fit/available claims lacked explicit calculations or evidence. | 5 | Derived-claim validator tests. | FIXED |
| GND-06 | Filtering, ranking, explanation, and display did not share one factual basis. | 5 | Recommendation artifact factual-basis test. | FIXED |
| GND-07 | Date/party changes reused stale volatile facts. | 5/8 | Date change, party change, and combined rehydration interaction. | FIXED |
| ENT-01 | Candidate result lists had no stable identity/version. | 6 | Stable candidate-list ID and coexistence tests. | FIXED |
| ENT-02 | Historical ordinal references resolved against the latest list. | 6/8 | Previous-list ordinal tests and `tour so 2 luc truoc` adversarial test. | FIXED |
| ENT-03 | Tours visible in text/structured output were not always stored as referenceable entities. | 6 | Visible identity extraction test. | FIXED |
| ENT-04 | Reload lost recommendation card reconstruction. | 6 | Card snapshot merge and frontend pagination/reload tests. | FIXED |
| ENT-05 | Backend entity IDs and frontend reconstructed presentation diverged. | 6 | Pre/post reload equivalence and frontend merge tests. | FIXED |
| ENT-06 | Message history silently truncated beyond 100 messages. | 6 | 130-message pagination tests. | FIXED |
| ENT-07 | Conversation list silently truncated beyond 20 conversations. | 6 | 35-conversation pagination tests. | FIXED |
| ENT-08 | Bare ordinal references failed after reload/restart. | 6/8 | Serialized state/restart and historical ordinal interaction. | FIXED |
| ENT-09 | Persisted entity memory risked becoming the source of stale price/availability facts. | 5/6 | Stable ID with rehydrated changed facts and deleted entity tests. | FIXED |
| CTR-01 | Backend treated HTTP 200 as semantic success without validating AI payload. | 7 | Empty reply, invalid action, missing SEARCH structure tests. | FIXED |
| CTR-02 | Missing/empty required fields failed late as generic 500. | 7 | Early `AI_RESPONSE_INVALID` contract tests. | FIXED |
| CTR-03 | AI rate limiting could key all proxied users by backend IP or trust spoofed identity. | 7 | User isolation and trusted HMAC principal tests. | FIXED |
| CTR-04 | Provider failure fallback changed action/candidate coverage or invented facts. | 7/8 | Gemini 429 parity and adversarial historical-candidate fallback. | FIXED |
| CTR-05 | Booking parser could treat policy reads as cancellation commands. | 3/7 | Policy/cancel/mixed routing tests. | FIXED |
| CTR-06 | Downstream booking/provider layers could override authoritative mixed-intent action. | 3/7/8 | Mixed routing and booking-policy + historical-tour interaction. | FIXED |
| CTR-07 | Infrastructure failures masqueraded as no-result, missing preference, or clarification. | 4/7 | Typed RAG/provider/DB error tests. | FIXED |
| CTR-08 | Backend-AI error taxonomy/schema compatibility was incomplete. | 7 | Error-envelope and contract-version tests. | FIXED |
| CTR-09 | Provider/index degradation did not propagate as capability state. | 4/7/8 | Provider/fallback health and degraded-success metadata tests. | FIXED |
| CTR-10 | Invalid AI/provider/adapter failure could partially commit a logical turn. | 1/7 | Invalid payload plus atomic failure persistence tests. | FIXED |
| P8-NEW-01 | Open-destination recognition omitted common `ok/oke/thoai mai` variants. | 8 (Phase 2 root cause) | Phase 8 adversarial semantic corpus. | FIXED |
| P8-NEW-02 | Negation/exclusion grammar omitted `khong khoai` and `ne`. | 8 (Phase 2 root cause) | Phase 8 adversarial semantic corpus. | FIXED |
| P8-NEW-03 | Optional-duration grammar only recognized relaxation before the number. | 8 (Phase 2 root cause) | Postfixed `khong bat buoc` adversarial test. | FIXED |
| P8-NEW-04 | Child-removal slang was neither claimed by traveler extraction nor protected from interest extraction. | 8 (Phase 2 root cause) | Child removal + no false family interest test. | FIXED |
| P8-NEW-05 | Historical entity grammar treated `so/luc truoc` and policy words as a tour name. | 8 (Phase 6 root cause) | Reload historical ordinal and policy interaction tests. | FIXED |
| P8-NEW-06 | Frontend API normalization discarded typed `retryable`, `source`, and request identity. | 8 (Phase 7 boundary) | `TTTN/test/apiError.test.js`. | FIXED |
| OPS-01 | In-app browser runtime cannot start because required sandbox metadata is missing. | 8 | Browser skill setup and minimal probe both failed before browser code executed. | NOT TESTABLE |
| OPS-02 | True authenticated multi-tab behavior needs a running full stack and browser runtime. | 8 | No safe live environment; concurrency invariants covered below the browser layer. | NOT TESTABLE |
| OPS-03 | Real Mongo outage/recovery would require a configured runtime/replica set. | 8 | Isolated Mongo outage classification and Mongo fallback tests passed. | NOT TESTABLE |
| OPS-04 | Stale non-empty live Chroma requires a configured disposable namespace. | 8 | Isolated stale non-empty namespace detection passed without mutation. | NOT TESTABLE |
| OPS-05 | Real inventory/availability race requires a transactional inventory fixture/service. | 8 | Party/date/departure recalculation is covered deterministically; live race unavailable. | NOT TESTABLE |
| OPS-06 | Retrieved-data prompt injection cannot be proven against a live provider in this environment. | 8 | Simulated malicious provider output was rejected and replaced by grounded fallback. | MITIGATED |
| OPS-07 | True distributed deployment behavior needs multiple backend/AI processes and shared infrastructure. | 8 | Two lifecycle instances sharing repository ownership passed; process-local limiter remains deployment-scoped. | NOT TESTABLE |
| OPS-08 | Live Gemini behavior requires credentials and explicit live-smoke opt-in. | 8 | Full suite records one gated live-Gemini skip; 429/unavailable/invalid simulations passed. | NOT TESTABLE |

## Totals

- Unique normalized findings: **76**
- `FIXED`: **68**
- `MITIGATED`: **1**
- `BLOCKED`: **0**
- `NOT REPRODUCIBLE`: **0**
- `NOT TESTABLE`: **7**
