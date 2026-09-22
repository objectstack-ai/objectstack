---
'@objectstack/spec': minor
---

**BREAKING for callers** — `parseFilterAST` now refuses a blank `$between` endpoint, exactly as the authoring schema already does. An empty-string or absent (`undefined`) bound, at either side, is refused with `INVALID_FILTER` / 400, and the refusal names the blank side — MIN or MAX, plus the index (#19071).

Clause-②: no

## What changed, and why it is the implementation catching up rather than a new rule

`RANGE_ENDPOINT_DESCRIPTION` — the published endpoint contract shared by both of `$between`'s bounds — has stated since 2026-09-17 that "BOTH are required NON-BLANK: an empty string, null and undefined are refused, and the refusal names the blank side". That rule shipped at the authoring schema only. The runtime door disagreed with it: `parseFilterAST({ at: { $between: ['', ''] } })` returned the filter unchanged, same object reference, measured on `origin/main` before this change and re-measured after.

One published sentence therefore had two truth values, decided by which door a caller came through — and the door that passed it is the one that matters most here. A caller that lowers a filter with `parseFilterAST` and hands it straight to a driver (an embedder; this repo's own driver conformance suites) never meets the schema. At every backend a blank bound stops bounding on that side while the range still reads as a complete two-element range, so the query runs with one meaningless boundary and returns rows outside the window its filter names, with no signal at any layer.

```
FROM  parseFilterAST({ at: { $between: ['2026-01-01', ''] } })
      -> { at: { $between: ['2026-01-01', ''] } }   // unchanged, same reference,
                                                    // straight on to the driver

TO    parseFilterAST({ at: { $between: ['2026-01-01', ''] } })
      -> throws INVALID_FILTER / 400:
         'Operator "$between" on field "at" requires two non-blank bounds.
          Received an empty string at where.at.$between[1] (the MAX bound). …'
```

## Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `{ $between: ['2026-01-01', ''] }` | `{ $between: ['2026-01-01', '2026-12-31'] }` — the bound you meant, written out |
| `{ $between: ['', 100] }` | `{ $between: [0, 100] }` — the lower bound you meant |
| a range that was only ever bounded on ONE side | `{ "$gte": min }` or `{ "$lte": max }` — a one-sided bound is not a range |

**The one-line fix: write the bound that is missing, or — if only one side was ever meant — drop `$between` and write that side as a scalar comparison.** The same prescription the authoring door already gives, now given at the door an embedder actually reaches.

## What does NOT change

- **`null` bounds** keep their own message, refused since 2026-08-31. It prescribes the null PREDICATE, because an author who wrote `null` was reaching for absence and an author who left a bound empty was reaching for a bound — two blank spellings, two intents, two remedies. `null` is also checked first, so a pair that is blank on one side and null on the other keeps the message it has always had.
- **Whitespace-only endpoints** are still accepted, at BOTH doors. The 2026-09-17 ruling is the empty string; the authoring door pins `{ $between: [' ', 'M'] }` as parsing green on purpose, and trimming here would re-open the very split this change closes, in the opposite direction.
- **Falsiness.** `{ $between: [0, 0] }` and `{ $between: ['0', '9'] }` lower exactly as before. The rule is blankness, not falsiness.
- **`$in` / `$nin` members.** A falsy or empty-string MEMBER is a value, not an absence (2026-08-31, `filter-comparand-shape.test.ts`). Only a range ENDPOINT is judged here, and only the `$between` row of that pin moves.
- **Arity**, which was already refused with its own message, and every legal range: numbers, Dates, ISO days, UTC instants, clock times and non-temporal text all lower byte-identically, same object reference.
- **The published export surface.** No export is added, removed or renamed; the refusal rides the existing `$between` arm of the shared comparand-shape door, so the engine's delegating wrapper inherits it unchanged.

<!-- adr-0087: not-required (already-registered filter-between-blank-endpoint-refused) the transition from a blank $between endpoint to two present, non-empty bounds was registered by #18012 for this same surface set; this change adds no new transition, it brings the runtime lowering face under the one already on the ledger, and the entry's own prescription and acceptance criteria apply verbatim -->
