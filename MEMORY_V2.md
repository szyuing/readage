# Memory V2 — Production Source of Truth

> Updated 2026-07-24. This document describes the **active** learning-memory system.  
> Legacy pure helpers remain in `src/lib/proficiency.legacy.ts`; async queries use `*Async` in `src/lib/proficiency.ts`.

## 1. What Memory V2 owns

| Concern | Implementation |
|---|---|
| Exposure / click evidence | `src/lib/memoryV2/*`, `readingExposure.ts`, `memoryV2Integration.ts` |
| Daily grade + FSRS review | `evidenceAggregation.ts`, `fsrsIntegration.ts` |
| Local calendar day / day-end | `dateUtils.ts` (`formatToParts`, `getUtcInstantForLocalDayEnd`) |
| React ready state + refresh | `memoryStore.ts`, `MemoryProvider.tsx`, `hooks.ts` |
| Recommendation ranking | `recommendation.ts`, `memoryV2RecommendationAdapter.ts` |
| Interactive resolve chain | `resolveRecommendation.ts` → App |
| Persistence | IndexedDB preferred (`indexedDbImpl.ts`), localStorage fallback |

## 2. Learning units

- Exposure and click share one **learning unit**: a normalized word **or** highlighted phrase.
- Phrases replace their component tokens during extraction (`extractLearningUnits`).
- Occurrence ids: `{articleId}:p{paragraph}:w{tokenIndex}:{wordId}`.
- Fast clicks auto-create matching exposure so `validExposureCount > 0` before grading.
- Function words (`the`, `and`, …) are **not** tracked unless allowlisted via highlights / keywords.

Grading (per day, once to FSRS):

- No valid exposure → no grade  
- Exposure without click → Good  
- Any valid click that day → Again (sticky)

## 3. Time zones

- Events store `localDate` as `YYYY-MM-DD` in the **user IANA zone** (never via `toLocaleString` → `Date` → `toISOString`).
- FSRS review time is the **end of that local calendar day** as a UTC instant.
- Historical finalization runs on app start, focus, visibility restore, and a midnight timer.

## 4. Recommendation chain

```text
Memory V2 local rank
  → unread library fallback
    → AI recommend_article (only if library empty; ≤15s client / ≤14s server)
      → cancel / timeout → library or error
```

Cold start:

- If global proficiency map is small **or** article lemma coverage &lt; 20%, hard unknown / learning-zone filters are skipped.
- Untracked lemmas are not treated as hard “unknown” until personalization is reliable.
- Empty proficiency still yields non-zero cold-start scores (topic / CEFR match).

Explicit `reviewWords` are passed into `recommendForReview` and take precedence over system due words.

## 5. React lifecycle

```text
MemoryProvider
  → store.start()  // prefer IDB, migrate LS once, finalize history
  → version++ on write / finalize
  → hooks subscribe via useSyncExternalStore
```

Query hooks (`useDueWords`, `useAllWordProficiency`, `useProficiencyStats`) wait for `ready` and re-read when `version` changes. Quota failures surface as a red banner via `useMemoryStorageError`.

## 6. Storage policy

1. Prefer IndexedDB (`english-ai-memory-v2`); fall back to localStorage.  
2. One-time migration copies `english-ai:v2:memory:*` keys into IDB.  
3. After a local day is finalized, raw events for that day are deleted (daily evidence + memory state remain).  
4. Paragraph exposures batch-write via `recordBatchEvents` / `saveRawEvents`.  
5. localStorage quota errors are rethrown (not silently swallowed).

## 7. Compatibility layer

| API style | Location | Role |
|---|---|---|
| Pure sync helpers (`toLemma`, production mapping, legacy FSRS math) | `proficiency.legacy.ts` | Shared utilities / tests |
| Async Memory queries (`getDueWordsAsync`, …) | `proficiency.ts` | Active store reads |
| Live UI proficiency | Memory V2 hooks | Due words, stats, My Learning |

Do **not** reintroduce sync facades that return Promises or no-op empty maps.

## 8. Release gate checklist

- [ ] `npm test` green  
- [ ] `npm run lint` green  
- [ ] `npm run build` green  
- [ ] Cold start: empty memory → local library article (console `📚` / `📖`, not forced AI)  
- [ ] Recommend cancel + ≤15s budget  
- [ ] Targeted `reviewWords` article contains requested lemmas when candidates exist  
- [ ] Phrase click → Again grade with matching exposure  
- [ ] Asia/Shanghai 00:30 → localDate = that calendar day  
- [ ] Overnight / focus: due stats refresh after day change  
- [ ] Storage: stop-words reduce keys; quota shows banner  

## 9. Related docs

- `WORD_PROFICIENCY_SYSTEM.md` — historical / legacy FSRS helper detail (see banner there).  
- Process notes under `MEMORY_V2_*.md` are archival; prefer this file for current behavior.
