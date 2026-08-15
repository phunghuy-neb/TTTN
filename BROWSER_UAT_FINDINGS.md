# Browser UAT Findings

This file records the browser findings that drove Phase 9B. `FIXED` means the root cause is covered by browser-equivalent tests and the isolated Backend-to-AI HTTP reproduction. It does not mean the human browser rerun has passed.

Allowed status values: `PASS`, `FIXED`, `MINOR`, `BLOCKED`.

## Runtime and Test Path Difference

The earlier automated suites did not exercise the complete browser path. Semantic tests called extraction and merge helpers directly, action-policy tests mocked RAG, and entity tests exercised candidate helpers without the real Backend booking adapter, controller persistence, Mongo metadata, response reconstruction, or frontend-shaped request payload. The browser path exposed compatibility projections, booking evidence, real inventory conflicts, persisted candidate-list transitions, and deterministic response composition that the isolated fixtures did not contain.

## Root-Cause Trace

| Browser case | Trace | Expected state | Actual state before Phase 9B | First wrong component | Root cause | Status |
| --- | --- | --- | --- | --- | --- | --- |
| B01 | Browser -> Backend -> AI recommendation | Search with total budget and open destination | Initial recommendation worked | None observed | Baseline setup turn | PASS |
| B02 | Previous state -> exclusion extraction -> RAG | Preserve budget and exclude beach concepts | Beach exclusion generally worked | None observed | Baseline exclusion turn | PASS |
| NEW-03 | Semantic V2 -> compatibility projection -> RAG -> reply | Budget range 6-8m, scope unspecified | Lower bound disappeared and scope became per-person | Compatibility/RAG boundary | Flat projection and copy treated an unspecified scope as per-person | FIXED |
| NEW-10 | Span registry -> destination extraction -> exclusion evidence | Excluded destination only | Da Lat became a positive destination and was returned | Destination extraction | Open-vocabulary destination grammar consumed a negated clause before exclusion ownership | FIXED |
| NEW-11 | Span registry -> duration extraction -> destination extraction | Duration max 3, no destination | "toi da" became destination text | Destination extraction | Duration operator spans did not own their clause before destination extraction | FIXED |
| NEW-14 | Colloquial extraction -> action policy -> response composition | Travelers 2, budget about 8m, duration about 3, open destination, SEARCH | Generic-answer text was returned with recommendation cards | Semantic extraction and response composition | Colloquial units were unsupported and generic ANSWER output could still attach grounded cards | FIXED |
| B03 | Backend booking evidence -> action policy -> semantic merge | Travelers 2 -> 3 and SEARCH | Generic passenger change was routed to booking lookup | Backend booking adapter | Booking activation accepted generic change language without booking-specific evidence | FIXED |
| B05 | Semantic duration -> Mongo recall -> hard filtering -> ranking | Approximate 3-day preference affects candidates | Two-day candidates remained first | RAG filtering | Approximate budget was hardened before ranking; the newest approximate duration refinement had no operator-aware priority | FIXED |
| B07 | Destination evidence + interest exclusion -> shared retrieval evidence | Da Lat allowed unless tour metadata proves beach semantics | Da Lat was rejected by the old beach exclusion | Retrieval evidence | Unbounded substring/concept matching treated "bien may" as beach evidence | FIXED |
| B09 | Entity resolution -> action routing -> persisted selection | Ordinal 2 resolves the second visible tour | Request repeated the recommendation list | AI orchestration | Entity resolution ran after request-type routing, so the ordinal became a generic search | FIXED |
| B10 | Selected entity -> anaphora -> factual grounding | "tour do" keeps the selected tour and returns price/availability | Entity selection was asked again | Entity lifecycle | B09 did not persist a single selected entity before the anaphoric fact turn | FIXED |
| B11 | Selected entity + party delta -> booking evidence -> grounding | Rehydrate availability for party size 4 | Routed to booking lookup | Backend booking adapter | Generic passenger updates were treated as booking mutations | FIXED |
| B13 | Criteria delta -> booking evidence -> action policy | Duration max 3 and SEARCH | Routed to booking lookup | Backend booking adapter | Generic "doi" plus duration language activated booking context | FIXED |
| B15 | Action policy -> RAG exclusion -> candidate lifecycle | Different list or an explicit exhausted result | Same list was returned as if new | Action policy/RAG boundary | No typed alternative-results operation and no active-list exclusion | FIXED |
| B16 | Historical ordinal -> candidate-list selection -> persistence | Resolve the list where ordinal 2 was selected | Immediate previous refreshed list remapped ordinal 2 | Candidate-list lifecycle | Only active/previous pointers existed; the selected ordinal had no stable source-list anchor | FIXED |
| B17 | Historical entity -> mixed fact plan -> grounding | Availability plus cancellation policy for one tour | Entity clarification repeated | Entity lifecycle | Historical selection failure left no stable entity for the mixed read-only turn | FIXED |
| B18 | Embedded historical ordinal -> pending clarification -> fact request | Resolve persisted historical entity and answer price | Stale clarification overrode the resolved ordinal | Action/entity boundary | Successfully embedded ordinal resolution did not clear stale entity clarification | FIXED |
| UAT-COPY | Decision/evidence -> deterministic reply composer | Natural, factual, context-aware wording | Repeated templates and malformed relaxation grammar | Response composition | One template ignored semantic operators, scope, actual evidence, and zero-result cause | FIXED |

## Verification Completed

- Browser-equivalent Phase 9B suite: 11 tests passed.
- Phase 9C Chrome-blocker suite: 12 tests passed, including no-diacritics exclusion, retained multi-turn exclusion, action/query separation, entity-bound descriptive rewrites, and provider-sourced rewrite integration.
- Mongo entity-resolution suite: 4 tests passed, including partial title/destination aliases that differ from the administrative `location` field.
- Isolated real HTTP runtime reproduction: 34 assertions passed through Backend, AI, persistence, and response reconstruction.
- AI full regression: 191 passed, 1 gated live-provider test skipped, 0 failed.
- Backend full regression: 73 passed, 0 failed.
- Frontend tests: 6 passed; production build completed.
- `git diff --check`: no whitespace errors; only existing Windows line-ending warnings were reported.

## Phase 9C Chrome Retest

| Browser case | Chrome evidence | Status |
| --- | --- | --- |
| P9C-1 hard beach exclusion | A clean recommendation initially included Hội An. After `tôi không muốn đi biển`, Chrome showed only Sa Pa, Đà Lạt and Huế. Hội An stayed absent after changing to 3 travelers and adding an approximate 3-day duration. | PASS |
| P9C-2 destination evaluation routing | A clean Hội An suitability question produced `ANSWER/general_answer`, `mongo_only` retrieval, and direct/hydrated/selected entity `000000000000000000000006`; it no longer entered SEARCH or used the full inventory. | FIXED |
| P9C-2 live answer completion | Gemini returned `503 AI_PROVIDER_UNAVAILABLE`; the UI used a grounded fallback for the same Hội An entity instead of a false search/no-result response. A live suitability answer could not be verified. | BLOCKED |
| P9C-3 live Gemini grounding validation | Three clean Chrome Mode A attempts reached the provider with the correct Hội An grounding, but Gemini returned `503` before producing text. Deterministic and provider-sourced integration tests prove unsupported quantity/weather/modifier rewrites with `fallbackUsed=false`, but live Chrome rewrite remains unverified. | BLOCKED |

`PROVIDER_BLOCKED` is an external live-provider condition, not a Browser UAT PASS. Phase 9C does not declare production readiness.

## Manual Retest Required

The human browser rerun is still required for every `FIXED` row. This document does not declare Real Browser UAT PASS or production readiness.
