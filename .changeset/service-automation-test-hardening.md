---
---

test(automation): big-loop run-history integration test + fix pre-existing test-file type errors

Test-only; no runtime/API change (nothing under `src/` behaviour is touched), so
this releases nothing. Adds an end-to-end `run-history.test.ts` case exercising
the region-aware history compaction (#3234) through the real engine
(execute → recordTerminal → restart → getRun) with a >MAX-step loop, and clears
the pre-existing `tsc --noEmit` errors across the package's test files (missing
`maturity`, implicit `any`, `ConnectorProviderFactory` test-double defs, an
unused param, a `{}`-typed output access) so the whole package type-checks clean.
