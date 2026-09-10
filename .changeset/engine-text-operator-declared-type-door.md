---
"@objectstack/objectql": minor
---

feat(objectql)!: refuse a text operator aimed at a field whose DECLARED type can never store a string — `INVALID_FILTER` 400 at the engine's field-aware door (#15773)

**BREAKING** for a caller that aims `$contains` / `$notContains` / `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike` at a numeric, boolean, temporal or structured-JSON field: the call used to be answered (with `[]`, with every row for `$notContains`, or with a dialect accident) and is now refused with `400 INVALID_FILTER`. Shipped as `minor` under the repo's launch-window convention. Execution lane (2) of the maintainer ruling on #15661 (decision batch #43, option C-deny); lane (1) is the contract it consults, `@objectstack/spec/data`'s `filter-text-operator-declared-type.ts` (#15804).

## What was wrong

Measured on `origin/main` `59db8a02cb` with a real `ObjectQL`, the lane-1 fixture registered and a recording driver beneath — the filter reached the driver verbatim every time:

| filter | before | after |
|:--|:--|:--|
| `{ f_number: { $contains: '5' } }` | driver read, `[]` | `400 INVALID_FILTER` |
| `{ f_summary: { $contains: '5' } }` | driver read, `[]` | `400 INVALID_FILTER` |
| `{ f_json: { $contains: 'a' } }` | driver read, `[]` | `400 INVALID_FILTER` |
| `{ f_date: { $startsWith: '2026' } }` | `400 INVALID_FILTER` — from the #8690 TEMPORAL door, about the COMPARAND | `400 INVALID_FILTER`, naming the field's declared type |
| `{ f_text: { $contains: 'a' } }` | driver read | unchanged — driver read |

What the driver then answered is #14079's option-A row: no row for a positive operator, EVERY row for `$notContains`. Neither answer is wrong beneath the door — it is the declared answer — and neither carries any signal that the field can never hold a string, which is the cell this closes.

## What it does now

- **One door, at the engine's single filter collection point** (`lowerWhereFilterArray`), third in the ladder: comparand shape (#5869) → materializable field (#8296 / #8371) → **declared type (this)** → temporal comparand (#8690). It runs before the temporal gate deliberately: a text operator over a `date` field was already refused there, with the same wire envelope but a message about the comparand, which sends the author to fix a value that could never have made the filter runnable.
- **The refused classes are DERIVED, never re-listed**: the verdict is `@objectstack/spec/data`'s `textOperatorDoorVerdict`, over `NUMERIC_VALUE_TYPES` ∪ `BOOLEAN_VALUE_TYPES` ∪ `CALENDAR_DATE_TYPES` ∪ `INSTANT_TYPES` ∪ `CLOCK_TIME_TYPES` ∪ `STRUCTURED_JSON_TYPES`. A type added to any of those sets is refused with no change in this package. String-valued classes pass unchanged — `STRING_VALUE_TYPES`, `autonumber`, option codes (single AND multi, so `tags` keeps its substring filter), reference ids and the file classes.
- **No vocabulary is minted.** `INVALID_FILTER` already exists (`StandardErrorCode`) and is this package's filter envelope; the refusal carries `code`, `status` and `httpStatus` per ADR-0112 D5, and names the field, its declared type and the operator.
- **Both filter forms and every verb**: the object form and the `FilterArray` sugar, on `find` / `findOne` / `count` / `aggregate` / `update` / `delete`, plus the per-aggregation `filter` position (#10576's second filter slot on `aggregate`) — a door that spoke on `where` alone would answer one mistake two ways within one verb.
- **Beneath the door nothing moves.** A direct driver call never passes this seam and keeps answering `FILTER_TEXT_CASES`' option-A row (#14079), as does `having` — both pinned.

## Deliberately unjudged

- **A dotted key** (`f_address.city`) — `filter-dotted-head`'s subject, whose structured-JSON heads are deliberately unjudged there (#8371). The door steps over it rather than re-closing that carve-out.
- **An unknown filter field** — the engine keeps its registry-less tolerance; this door adds no second opinion about a name.
- **A registry-less host** (`schema.fields` absent) — a door that cannot see the field map invents no verdict, the same early return both neighbours make.
- **`formula`** — judged one door earlier. `assertFilterIsMaterializable` (#8296) refuses every filter over a `formula` field with `INVALID_FIELD` 400, for the broader reason that no driver materialises a column for it, so a formula's declared `returnType` is never the deciding fact at this seam. Not reordered around: that would answer ONE condition with TWO wire codes chosen by `returnType`. The divergence from lane (1)'s formula rows is pinned by name in `engine-text-operator-declared-type-door.test.ts` rather than dropped.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `where: { amount: { $contains: '500' } }` | `where: { amount: { $eq: 500 } }` (or `$gte` / `$lte` for a range) |
| `where: { created_at: { $startsWith: '2026' } }` | `where: { created_at: { $gte: '2026-01-01', $lt: '2027-01-01' } }` |
| `where: { is_open: { $contains: 'true' } }` | `where: { is_open: true }` |
| `where: { address: { $contains: 'Berlin' } }` | filter a stored text field, or `where: { 'address.city': { $contains: 'Berlin' } }` (a dotted path stays unjudged) |
| `where: { tags: { $contains: 'urgent' } }` | unchanged — option codes are strings and still pass |
