---
'@objectstack/spec': patch
'@objectstack/service-analytics': patch
'@objectstack/formula': patch
'@objectstack/objectql': patch
---

Published comments that named `driver-memory`'s retired reference matcher as a live filter backend now name what replaced it

Clause-②: no

`driver-memory`'s reference matcher (`memory-matcher.ts`) was retired in commit `8fec76a2b`. Four published packages still described it as a live surface in text that ships:

- `@objectstack/spec`:
  - The backend table in the filter-logic conformance docblock, which ships in `data/index.d.ts` and `data/index.d.mts`, now lists the in-memory backend as `driver-memory`'s query path (`normalizeFilterCondition`, then mingo) where it listed `memory-matcher`, and says the matcher held that row until commit `8fec76a2b` retired it.
  - `src/data/filter.zod.ts` ships as source. In it, the `$icontains` implementation table lists `driver-memory`'s query path and analytics face, both on `asciiCaseInsensitiveRegexSource`. The `$like` / `$ilike` and `$empty` tables keep the matcher only in a note that commit `8fec76a2b` retired it. The `foldAsciiCase` docblock counts five JS evaluation faces where it counted six. The `asciiCaseInsensitiveContains` docblock names objectql's `having` and `formula` as its callers. The string-ordering note says `driver-memory`'s query path hands the comparison to mingo. Of these, the `foldAsciiCase`, `asciiCaseInsensitiveContains` and `FILTER_OPERATORS` docblocks also ship in the filter declaration chunk (`filter.zod-*.d.ts` / `.d.mts`).
  - `src/ui/view.zod.ts` ships as source. It now says that `driver-memory`'s query path runs `assertFilterConditionShape` through `convertToMongoQuery`, where it said `match()` did.
  - A comment inside `FILTER_TEXT_CASES` ships in `data/index.js` / `.mjs` and `browser/data/index.js` / `.mjs`. It now says the reference matcher measured case-exact until commit `8fec76a2b` retired it.
- `@objectstack/service-analytics`: two comments in `ObjectQLStrategy`, which ship in the JavaScript output (the first also in `index.d.ts` / `index.d.cts`), changed. The first names `driver-memory`'s query path, not its matcher, as a face that pins `{$not: {}}` as the zero-row filter. The second says in the past tense that `memory-matcher.ts` read `$regex` as a real regex, until `$regex` was retired and commit `8fec76a2b` retired the matcher too.
- `@objectstack/formula`: the comment over the `$icontains` arm in `matches-filter.ts` ships in `index.js` / `index.mjs`. It now names objectql's `having` as the other caller of `asciiCaseInsensitiveContains`. It says `driver-memory`'s reference matcher called it until commit `8fec76a2b` retired it, and that `driver-memory`'s query path folds through `asciiCaseInsensitiveRegexSource`.
- `@objectstack/objectql`: the comment over the `having` walker's `$notContains` arm in `having-filter.ts` ships in `index.js` / `index.mjs` and `core.js` / `core.mjs`. It now says the record-at-a-time faces (`formula` and this walker) answer the predicate on a stored value that is not a string, as `driver-memory`'s reference matcher did until commit `8fec76a2b` retired it.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
