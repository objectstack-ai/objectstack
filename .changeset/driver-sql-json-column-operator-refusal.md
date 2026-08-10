---
'@objectstack/driver-sql': patch
---

fix(driver-sql): refuse scalar-comparison operators on JSON/multi-value columns with 400 `INVALID_FILTER` instead of answering a silently wrong result

A `multiple: true` field — and every other `JSON_COLUMN_TYPES` field — is stored by this driver as a **JSON TEXT** column. The equality family lowered straight to SQL against that text with no column-type consultation, so a filter naming such a column compiled, ran, and returned a wrong answer with a `200`.

**Behaviour change (user-visible).** On a row whose `members` holds `["U1","U2"]`:

| filter | before | after |
|---|---|---|
| `{members:{$in:[U1]}}` | `200`, **0 rows** | `400 INVALID_FILTER` |
| `{members:{$eq:U1}}` | `200`, **0 rows** | `400 INVALID_FILTER` |
| `{members: U1}` (bare equality) | `200`, **0 rows** | `400 INVALID_FILTER` |
| `{members:{$nin:[U1]}}` | `200`, **the row it was asked to EXCLUDE** ⚠️ | `400 INVALID_FILTER` |
| `{members:{$ne:U1}}` | `200`, **the row it was asked to exclude** ⚠️ | `400 INVALID_FILTER` |
| `{members:{$lte:U1}}` | `200`, **1 row** (lexicographic, on the leading `[`) | `400 INVALID_FILTER` |
| `{members:{$contains:U1}}` | `200`, 1 row | **unchanged** |

**`$nin` is why this is a fix and not a documented footgun.** `members not in ('U1')` is TRUE — the stored text genuinely is not equal to that id — so "exclude these" compiled to "return everything". `$in` fails **closed** (fewer rows than exist, bad but narrowing); `$nin` and `$ne` fail **OPEN**, so any exclusion built on them silently stops filtering and the failure direction is *widening*. A downstream delete-guard written as `plans.find({ where: { assignees: { $in: memberIds } } })` therefore never fired once since it shipped, threw nothing, logged nothing, and type-checked — and a `200` with `[]` is byte-identical to a query that legitimately matched nothing, so no caller had anything to key on.

**What is refused:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$between`, the bare `{ field: value }` spelling, and the infix spellings the normalised emitter also answers (`=`, `<>`, `in`, `nin`, `not_in`, `notin`, …) — on any column this driver stores as JSON, i.e. `field.multiple` arrays **and** the structured-JSON types (`address`, `location`, `composite`, the file-metadata and multi-option types). The structured-JSON half is included because the mechanism is the JSON-text storage rather than the array-ness: `{address:{$nin:['Beijing']}}` showed the identical fail-open inversion.

The refusal names the operator, the field, why the column cannot answer it, states that the filter **was not applied**, and prescribes the working spelling. It carries the same ADR-0112 envelope as the unknown-operator refusal (`INVALID_FILTER` / 400), on every face that lowers a filter: `find`, `findOne`, `count`, `aggregate`, `distinct`, and the where-clauses of `updateMany` / `deleteMany`.

**What does NOT change:** `$contains`, `$notContains`, `$startsWith`, `$endsWith`, `$icontains` — the `LIKE` family matches the serialization as text, and `$contains` (or an `$or` of `$contains` for any-of) is the working membership spelling this refusal points at. `$null` / `$exists` also keep working: the column's presence is a well-formed question whatever it holds. Filters on scalar columns are untouched, and a table this driver was never told about (no registered field types) is unaffected — the gate fires only where the column is KNOWN to be JSON.

Giving array columns a real membership operator (`$overlaps` / `$containsAny`) is a separate question about the closed `FILTER_OPERATORS` set and is deliberately not answered here.
