---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

New private package `@objectstack/scenarios` (`packages/qa/scenarios`, not published): the zod schema and loader for scenario cards, plus the open library's three control cards under `docs/qa/scenarios/`. A card states an authoring prompt, the structural `expect` the deterministic scorer reads, capability tags (area half closed to the platform-checklist areas) and a closed category, seed rows with data questions whose truth the loader computes from a declarative spec (`count | sum | avg | min | max | topN | unanswerable`, with filters, relative windows against a card-level `asOf`, relation paths through declared lookups, groupBy and order), personas with row scope whose per-persona truths are computed too, write operations that declare their outcome (post-state, refusal code or pending confirmation, with the audit actor), five guardrail checks, optional agent actions, and one iteration request. A malformed card is refused with its file and field path. No `packages/spec` change and no public surface change.
