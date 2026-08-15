# FINAL REMEDIATION REPORT

## Verdict

**SYSTEM REMEDIATION COMPLETE within the reproducible/testable scope.**

No reproducible HIGH or CRITICAL issue remains in the Phase 1-8 automated, isolated operational, or HTTP-preview scope. Seven live-environment checks remain explicitly `NOT TESTABLE`; they are not counted as passes and are listed under Remaining risks.

## Observability architecture

Each valid chat transport attempt now has a `requestId`, while retries retain the same stable `clientMessageId`/`logicalTurnId`. Backend stores all attempt IDs on the same `ChatTurn` and persists one redacted trace snapshot with:

- request/logical-turn/conversation identity, history epoch, turn sequence, and one-way-hashed user identity;
- previous Semantic State V2, page delta, extracted delta, and merged state;
- authoritative action decision/reason and pending typed clarification;
- RAG filters, retrieval mode/status, direct/discovered/hydrated/selected tour IDs;
- deterministic rank order, semantic evidence, factual fingerprints, price/departure/party basis;
- provider/fallback state, factual validation result, response hash/length/candidate summary;
- lifecycle and persistence status for success, typed failure, retry, and clear-history cancellation.

The internal trace is validated at the Backend-AI boundary and is not returned publicly. Prompt text, history content, credentials, raw semantic spans, direct user IDs, and unnecessary personal fields are removed. Public responses only add/echo `requestId` and `x-request-id`.

Capability health now reports `process`, `mongo`, `chroma`, `index`, `provider`, and `fallback` separately. Provider absence/degradation and index degradation cannot leave the overall capability status false-green.

## Phase 8 changes

### Backend

- Added `backend/src/services/chatTurnTraceService.js`.
- Extended `backend/src/models/ChatTurn.js` with additive `requestId`, `requestIds`, and `trace` fields.
- Updated `backend/src/services/chatTurnLifecycleService.js` to persist trace status atomically and support legacy `trace: null` turns without destructive migration.
- Updated `backend/src/controllers/chatController.js` and `backend/src/services/aiAdapter.js` to propagate request/trace context.
- Updated `backend/src/services/aiResponseContract.js` to validate the additive internal observability schema.

### AI service

- Added `ai/tour-ai-service/src/services/aiTraceService.js`.
- Instrumented semantic preparation, action policy, retrieval/ranking/grounding, provider fallback, and validation.
- Added truthful provider/fallback capability health.
- Fixed adversarial language gaps for open destination, negation/exclusion, postfixed duration relaxation, child removal, and historical ordinal grammar.

### Frontend

- Generates a new transport `requestId` for every attempt while preserving logical-turn identity across retries.
- Preserves typed error `retryable`, `source`, and request identity.
- Keeps the public chat API backward-compatible; all new fields are additive.

## Final test totals

| Scope | Result |
|---|---:|
| Backend full regression | 68 passed, 0 failed |
| AI full regression | 167 passed, 0 failed, 1 gated live-Gemini skip |
| Frontend tests | 6 passed, 0 failed |
| Frontend production build | PASS, 684 modules transformed |
| Phase 1/6/7/8 Backend focused | 31 passed, 0 failed |
| Phase 2-8 AI focused | 93 passed, 0 failed |
| Phase 8 AI adversarial/interaction/health | 14 passed, 0 failed |
| Total non-overlapping full-suite tests | **241 passed, 0 failed, 1 skipped** |

The skip is the existing opt-in live Gemini smoke dataset. Simulated 429, unavailable provider, invalid response, and unsafe generated claim paths all passed.

## PASS 1-3 finding reconstruction

The repository and Git tree contain no standalone PASS 1 or PASS 2 findings document. Original PASS 1/2 IDs therefore cannot be quoted reliably. Findings were reconstructed from Phase 1-7 requirements, focused suite names, stress/metamorphic suites, and the current code paths.

PASS 3 has four explicit IDs in `backend/test/chatTurnLifecycle.test.js`:

- `AUD3-01` concurrent lost update: FIXED.
- `AUD3-02` retry/client-abort duplication: FIXED.
- `AUD3-03` clear-history resurrection: FIXED.
- `AUD3-04` failed-chat durable preference mutation: FIXED.

The complete normalized mapping is in `FINAL_AUDIT_MATRIX.md`.

## Final reproduction coverage

All 30 requested categories are represented by direct focused tests, stress/metamorphic tests, or Phase 8 interactions:

1. Redundant clarification, optional fields, and saved preferences: Phase 3 action policy.
2. Open destination: Semantic State V2, action policy, and open + soft-preference interaction.
3. Correction/override/removal and negation: semantic, context-stickiness, stress, and new slang corpus.
4. Budget/date/duration/traveler semantics: semantic operator tables and multi-turn stress.
5. Typed clarification and short answers: Phase 3 plus retry + clarification.
6. Fact query vs command and mixed intent: Phase 3/7 plus historical booking-policy interaction.
7. Concurrency/retry/abort/clear/failure consistency: Phase 1 plus Phase 8 combined races.
8. Mongo/Chroma split-brain, empty recovery, hard/soft, ranking, destination recall: Phase 4 plus degraded interaction.
9. Cross-tour grounding, departure price, party availability, derived claims: Phase 5 plus date + party interaction.
10. Historical ordinals, reload/cards, long pagination, deleted entities: Phase 6 plus adversarial historical grammar.
11. Invalid cross-service response, rate isolation, provider parity, booking routing: Phase 7 plus frontend typed-error regression.

No production parser or policy rule contains the audit sentences. The Phase 8 corpus uses different word order, punctuation, no-diacritics input, slang, multi-turn state, failures, and cross-phase combinations.

## New bugs discovered and fixed

| Severity | Root cause | Fix |
|---|---|---|
| MEDIUM | Open destination grammar omitted `ok/oke/thoai mai` variants. | Generalized intentionally-open alternatives. |
| HIGH | `khong khoai/ne` could become positive interest/destination constraints. | Generalized negation ownership for destination and interest spans. |
| MEDIUM | Duration relaxation only worked when the optional phrase preceded the number. | Supported optional language on either side of the duration span. |
| HIGH | Child-removal slang left stale child state and could create a family-interest false positive. | Claimed removal span in traveler extraction and cleared child-derived fields. |
| HIGH | `tour so 2 luc truoc` and policy wording could be misclassified as a tour name, forcing clarification. | Generalized historical/ordinal grammar and reference stop words. |
| MEDIUM | Frontend discarded typed dependency retry/source/request metadata. | Added pure error normalization and frontend tests. |

All affected Phase 2, 3, 5, 6, 7, and full AI regressions were rerun after the fixes.

## Operational verification

- Production SPA preview: HTTP 200 for `/` and `/ai-assistant`; root mount present.
- Real browser: `NOT TESTABLE`. Browser skill runtime and a minimal probe both failed before executing code with `codex/sandbox-state-meta: missing field sandboxPolicy`.
- Live Backend/AI: `NOT TESTABLE`. Runtime `.env`, Mongo connection, AI internal key, and disposable Chroma namespace are absent; no credentials or business data were synthesized.
- Multi-instance: two lifecycle instances sharing one repository completed one logical turn exactly once. A true distributed deployment and shared rate limiter remain `NOT TESTABLE` here.
- Mongo outage: isolated capability/fallback tests passed; destructive live outage/recovery was not attempted.
- Stale non-empty Chroma: isolated namespace detection passed without mutation; live namespace unavailable.
- Retrieved-data prompt injection: simulated unsupported claim was rejected and replaced by grounded fallback; live-provider attack remains mitigated, not proven.

## Remaining risks

- AI rate limiting is process-local; a distributed deployment should use a shared limiter store if global quotas are required.
- True browser multi-tab/auth/session behavior needs a working in-app browser runtime and configured full stack.
- Real Mongo failover, stale live Chroma repair, and inventory write races require disposable integration infrastructure.
- Live Gemini remains opt-in and was not inferred from simulated-provider success.
- Trace persistence increases `ChatTurn` document size; current redaction and array limits bound it, but production retention/TTL should be monitored.

These are not reproducible HIGH/CRITICAL failures in the available test scope. No business data, destructive migration, or unrelated file was modified to make tests pass.
