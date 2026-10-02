---
'@objectstack/spec': patch
'@objectstack/service-analytics': patch
---

Published comments that named `driver-memory`'s retired reference matcher as a live filter backend now name what replaced it

Clause-②: no

`driver-memory`'s reference matcher (`memory-matcher.ts`) was retired in commit `8fec76a2b`. Two published packages still described it as a live surface in text that ships:

- `@objectstack/spec`: the backend table in the filter-logic conformance docblock, which ships in `data/index.d.ts` and `data/index.d.mts`, now lists the in-memory backend as `driver-memory`'s query path (`normalizeFilterCondition`, then mingo) where it listed `memory-matcher`, and says the matcher held that row until commit `8fec76a2b` retired it.
- `@objectstack/service-analytics`: two comments in `ObjectQLStrategy`, which ship in the JavaScript output (the first also in `index.d.ts` / `index.d.cts`), changed. The first names `driver-memory`'s query path, not its matcher, as a face that pins `{$not: {}}` as the zero-row filter. The second says in the past tense that `memory-matcher.ts` read `$regex` as a real regex, until `$regex` was retired and commit `8fec76a2b` retired the matcher too.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
