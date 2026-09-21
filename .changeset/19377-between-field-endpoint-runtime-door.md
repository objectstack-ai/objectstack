---
'@objectstack/spec': minor
---

**BREAKING for callers** — `parseFilterAST` now refuses a `{ $field }` column reference as a `$between` endpoint, exactly as the authoring schema has since 2026-08-11. A reference at either bound is refused with `INVALID_FILTER` / 400, and the refusal names the side — MIN or MAX, plus the index (#19377).

Clause-②: yes

## What changed, and why it is the implementation catching up rather than a new rule

`RANGE_ENDPOINT_DESCRIPTION` — the published endpoint contract shared by both of `$between`'s bounds — has stated verbatim since 2026-08-11 that "A { $field } reference is NOT an endpoint shape: no backend resolves one inside a list". The ruling that wrote it (ADR-0049 enforce-or-remove) removed `FieldReferenceSchema` from both endpoint unions, and it shipped at the authoring schema alone. The runtime door disagreed with it: `parseFilterAST({ f: { $between: [{ $field: 'a' }, 'M'] } })` returned the filter unchanged, same object reference, measured on `origin/main` before this change and re-measured after.

One published sentence therefore had two truth values, decided by which door a caller came through — and the door that passed it is the one an embedder reaches by handing a lowered filter straight to a driver. There, nothing resolves the reference: the in-memory matchers compare the raw reference OBJECT and the range silently matches nothing, while both SQL faces refuse the position. A filter that names a window and answers no rows, or 400s one layer down, is what a caller got instead of a refusal they could act on.

```
FROM  parseFilterAST({ close_date: { $between: [{ $field: 'contract.start' }, '2026-12-31'] } })
      -> the same object, unchanged, straight on to the driver

TO    throws INVALID_FILTER / 400:
      'Operator "$between" on field "close_date" does not accept a { "$field": … }
       reference as an endpoint (at where.close_date.$between[0], the MIN bound). …'
```

## Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `{ $between: [{ $field: 'contract.start' }, '2026-12-31'] }` | `{ $between: ['2026-01-01', '2026-12-31'] }` — the literal bound the range was meant to stop at |
| a range that was genuinely meant to be column-to-column | `{ "$gte": { "$field": "a" }, "$lte": { "$field": "b" } }` — two scalar bounds, the position that compiles on every face |

**The one-line fix: write the literal bound, or — if the range really was column-to-column — drop `$between` and write the two bounds separately as `$gte` / `$lte`.** Nothing was evaluating the old filter, so treat the replacement as a new one and test it: at every backend the reference range either matched nothing or was refused.

## What does NOT change

- **A `{ $field }` reference as the WHOLE comparand of `$eq` / `$ne` / `$gt` / `$gte` / `$lt` / `$lte`.** That is #5222's shipped column-to-column capability, it is the alternative this refusal prescribes, and it lowers exactly as before — pinned by a lit control in the same file.
- **Every legal range.** Numbers, Dates, ISO days, UTC instants, clock times and non-temporal text all lower byte-identically, same object reference.
- **The three older endpoint carve-outs.** Arity, `null` (2026-08-31) and blank (2026-09-17) are checked first, so a pair carrying one of those keeps the message and the prescription it already had — an author who wrote `null` is still sent to the null predicate, not to a scalar comparison.
- **A plain object that is not a reference** keeps the comparand-TYPE door's own sentence, one step further on.
- **`$in` / `$nin` members.** The same 2026-08-11 decision rules a reference out of those positions too and `SET_MEMBER_DESCRIPTION` publishes it, but that is a second split over a different published sentence; it is measured and filed separately, and this change deliberately does not move it.
- **The published export surface.** No export is added, removed or renamed; the refusal rides the existing `$between` arm of the shared comparand-shape door, so the engine's delegating wrapper inherits it unchanged.

<!-- adr-0087: registered filter-between-field-reference-endpoint-refused -->
