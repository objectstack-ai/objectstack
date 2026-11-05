---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

New private package `@objectstack/scenarios` (`packages/qa/scenarios`, not published): the zod schema and loader for scenario cards, plus the open library's first nine cards under `docs/qa/scenarios/`. A card states an authoring prompt, the structural `expect` the deterministic scorer reads, capability tags (area half closed to the platform-checklist areas) and a closed category, seed rows with data questions whose truth the loader computes from a declarative spec (`count | sum | avg | min | max | topN`, with filter, groupBy and order), personas, write operations with five guardrail checks, and one iteration request. A malformed card is refused with its file and field path. No `packages/spec` change and no public surface change.
