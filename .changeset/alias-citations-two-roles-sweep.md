---
'@objectstack/spec': patch
'@objectstack/objectql': patch
---

Correct six `edit distance cannot reach` citations that are measurably false, and pin the role each alias entry actually plays.

`aliases` has two jobs, not one: filling a gap the distance fallback leaves empty, and overruling a hit the fallback reaches and gets wrong. The lookup is `aliases[aliasProbe(key)] ?? findClosestMatches(key, knownKeys, budget, 1)[0]` — the table is consulted first and wins outright — and the budget is `Math.max(2, Math.floor(key.length / 3))`. A sentence saying distance "cannot reach" the cited case denies the second job, and in three places the cited case is itself an example of it.

- **`latitude` → `lat` is an OVERRULE, not a gap** (`data/field-value.zod.ts`, `data/default-value-shape.ts`, `data/field-value.test.ts`, `data/default-value-shape.test.ts`, objectql `validation/record-validator.ts`). `latitude` is 8 characters, so the budget is 2; `lat` is 5 edits away and out of reach, but the declared `altitude` is exactly 2 — so without the curated entry the bare fallback answers `latitude` → `altitude` and points an author who wrote a GPS latitude at the elevation member. Four docblocks cited this pair as proof that aliases exist only where distance reaches nothing.
- **`postal_code` → `postalCode` never involved an alias at all** (`data/default-value-shape.ts`). Scoring folds case and separators on both sides, so it is 1 edit against a budget of 3 — the worked example rendered in that docblock is the fallback's own answer, not the `AddressValueSchema` table's.
- **`uri` → `url` is reachable and agreeing** (`data/driver/turso.zod.ts`). The block was headed "the spellings edit distance cannot reach"; that is true of five of its six rows and false of `uri`, which is 1 edit from `url` against a budget of 2. The row is a pin on an answer the fallback already gets right, not a gap-filler.

Prose plus new pins. No alias is added or removed, no schema, key list, strictness, suggestion or error message changes: `Clause-②: no`. The three roles are now asserted — `longitude` (gap), `latitude` (overrule, with the negative half), `altitud` (a plain typo still riding the fallback) in `data/field-value.test.ts`, and `dsn` (gap) beside `uri` (reachable) in `data/driver/turso.test.ts`.
