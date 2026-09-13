---
"@objectstack/service-analytics": minor
"@objectstack/spec": minor
---

feat(service-analytics)!: `min` and `max` are judged by the aggregate × field-type table too — all 74 refused pairs answer `400 DATASET_INVALID` through one compile door (#17560)

<!-- adr-0087: registered dataset-measure-selecting-aggregate-field-type-refused -->

**BREAKING** — an accept-set narrowing on a published authoring surface, and the last
one this table owed. A dataset measure pairing `aggregate: 'min'` (or `'max'`) with any
of the **37** field types outside the numeric, temporal and boolean classes — for example
`text`, `select`, `lookup`, `autonumber`, `json`, `multiselect`, `file`, `location`,
`vector` or `formula`; the ADR-0087 entry registered below carries the full list — used to
compile and reach the backend; it is now refused by
`compileDataset` with `DATASET_INVALID` / **400** before any query is built. Shipped as
`minor` under the repo's launch-window convention for accept-set narrowings.

⛔ This changeset adds no rows to any table and restates none. The verdict is
`AGGREGATE_FIELD_TYPE_COMPATIBILITY`'s — the one table `@objectstack/spec` declared in
#16353 under the director ruling of decision batch #59 ("both legs, table in spec") —
read through `isAggregateCompatibleWithFieldType`.

## What was wrong

The table refused these 74 pairs from the day it was declared, and **four declarations
gave three different answers about them**:

| declaration | what it said about `min` × `text` |
|---|---|
| `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (spec) | refused |
| `dataset-compiler`'s compile leg | never judged — `if (!DERIVING_AGGREGATES.has(aggregate)) return;` |
| `measureResultType` (service-analytics, #15768) | a supported `'string'` result |
| two shipped test files, in prose | "ruled C — the table is to be AMENDED to accept it" |

Driven through the real service door before anything was written, `min` / `max` over 13
sampled refused pairs all compiled and emitted SQL, with `avg` × `datetime` as the
firing control (refused, `DATASET_INVALID` / 400, no SQL) — so the zero was a reading of
the tree rather than of a blind harness.

The fourth row had nothing behind it. The card it cited (#17513) is closed as a
duplicate carrying zero rulings, and the one recorded ruling on this table says the
opposite. ⇒ The director ruling of decision batch #127 (2026-09-13) settled all three
sub-questions in one pass, because one shared fixture drove members of both halves:

1. **the string classes** (42 pairs) stay refused, as batch #59 ruled — ⛔ the table is
   not amended;
2. **the non-string classes** (32 pairs) are refused **and enforced**;
3. **`formula`** is refused on the table's own storage ground — it is VIRTUAL in SQL
   storage, no column is emitted, so no aggregate can be lowered to it whatever
   `returnType` says.

The divergence is real, and for these two aggregates it is the **ORDER** rather than the
arithmetic: string order is collation-dependent, so two backends answer two different
"smallest" values for one metadata document, and `min(jsonb)` does not exist on
PostgreSQL at all.

## What changed

- **`dataset-compiler`**: the scope condition is gone. `assertAggregateFieldTypeCompatible`
  judges all six `AggregationFunction` members against the table, through the same
  `DATASET_INVALID` / 400 door. The refusal message names the divergence its own
  aggregate class really has (`min` / `max` SELECT a stored value and diverge on order;
  `sum` / `avg` DERIVE a number and diverge on arithmetic) and prescribes accordingly.
- **`measureResultType`** asks `isAggregateCompatibleWithFieldType` before it answers, so
  the rule and the table agree **by construction**. Its `STRING_SOURCE_FIELD_TYPES`
  branch and its `formula` branch are retired with them; `min` / `max` over the temporal
  class still answers `'time'`, unchanged.
- **`AnalyticsServiceConfig.sourceFieldMeta`** no longer declares `returnType`. It was
  carried (#16236) for one reader — the retired `formula` branch — and a declared input
  nobody consumes is the declared-not-enforced shape Prime Directive #10 refuses.

  ⚠️ **That key was never released, so against every published version this removal is a
  no-op.** #16236 is still a pending changeset in the same release window as this one;
  the last published entry (17.4.0) says in as many words that `FieldSchema.returnType`
  "is not on `AnalyticsServiceConfig.sourceFieldMeta`'s return shape". The key was
  therefore added and removed inside one window and no published tarball ever carried it.

  **Host fix, one line:** drop `returnType` from whatever your `sourceFieldMeta` returns.
  You do not have to — the hook is a function RETURN position, so an extra key is not an
  excess-property error and is simply ignored at runtime — but keeping it declares an
  input nothing reads. Hosts on `AnalyticsServicePlugin` need no change at all: the plugin
  stopped relaying the key in this same change.

## FROM → TO, and the one-line fix

| you wrote | write instead |
|---|---|
| `{ aggregate: 'min' \| 'max', field: <a text/select/lookup/autonumber field> }` | `count` / `count_distinct` if you were counting; a **sort** on the list/report if you wanted the first or last RECORD |
| `{ aggregate: 'min' \| 'max', field: <a json/multiselect/file/location/vector field> }` | store the quantity you meant as a numeric or temporal field and aggregate that |
| `{ aggregate: 'min' \| 'max', field: <a formula field> }` | a formula emits no column; aggregate the stored field the formula reads, or persist the computed value |

⚠️ **Untouched:** those field types used as a **DIMENSION** (grouping, labelling,
bucketing, filtering), `count` / `count_distinct` over any type, `min` / `max` over the
numeric, temporal and boolean classes, and every `sum` / `avg` row #16778 and #16099
already settled. The refusal also still stands down rather than guessing wherever the
declared type cannot be resolved: no `sourceFieldMeta` wired, an unknown field, or a
`relationship.field` path whose column lives on a joined object.

⚠️ The hand-migration prescription ships as the ADR-0087 semantic TODO registered above,
which names the measure and the field type per affected pair — no lossless conversion
exists, because nothing can compute "the smallest text value" in a way every backend
agrees on.
