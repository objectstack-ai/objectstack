---
"@objectstack/objectql": minor
---

fix(objectql)!: a plain object with no `$` operator where a scalar field's value belongs is refused with `INVALID_FILTER` / 400 at `where`, a per-aggregation `filter` and `having`, on every driver

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of filter STRUCTURE at the engine's query door: a plain object with no `$` operator key under a column whose declared type holds scalar values. No authorable key, spelling, export or stored shape moves (the engine's door modules are internal; `@objectstack/objectql` exports nothing new and nothing less), and no stored row is read or rewritten. What is refused could match no record on any backend, and which value or operator the caller meant is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a filter's structure (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a filter may put beneath a scalar field. A plain object with no `$`-operator key — `{ "amount": { "a": 1 } }`, `{}` included — where a value of a field that holds scalar values belongs is refused by the engine before any driver is asked, where the in-memory driver answered it with no records (every record under `$not`) and the SQL driver refused it in its own words. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

The judged fields are the spec's scalar-valued classes: every type in `SCALAR_FILTER_HEAD_TYPES` (text-like, numeric, boolean, date, datetime, time, single-option, `autonumber`, `summary`), with or without `multiple: true`, and the multi-option types (`multiselect`, `checkboxes`, `tags`). A `having` column is judged by the type it carries: a `count` / `sum` / `avg` is a number, a groupBy or `min` / `max` column the type of its field, a date bucket a date or text label.

The refusal names the field, its declared type, the object's keys and the position (`where.amount`, `aggregations[1].filter.amount`, `having.total`). No mechanical rewrite exists, because which value or operator the caller meant is not in the object; the fix is one line by hand: compare the field with a value (`{ "amount": 12 }`) or an operator (`{ "amount": { "$gt": 12 } }`), and to filter by a related record, name a relation field.

Measured through `engine.find` / `engine.aggregate` and `POST /data/:object/query`, three rows:

| position | filter | before: memory · SQLite · PostgreSQL 16 | now, on all three |
|:--|:--|:--|:--|
| `where` | `{ amount: { a: 1 } }` (number), `{ title: { a: 1 } }` (text), and the select, boolean, date, autonumber, multi-select and `multiple: true` select twins | no records · the driver's 400 · the driver's 400 | `INVALID_FILTER` / 400, the engine's words |
| `where` | `{ $not: { amount: { a: 1 } } }` | every record · the driver's 400 · the driver's 400 | `INVALID_FILTER` / 400 |
| per-aggregation `filter` | `{ amount: { a: 1 } }`, `{ amount: {} }` | count 0 on all three | `INVALID_FILTER` / 400 |
| `having` | `{ total: { a: 1 } }` (a `sum`), `{ title: { a: 1 } }` (a groupBy) | no group on all three | `INVALID_FILTER` / 400 |
| `where` | control: `{ owner: { region: "NA" } }` on a `lookup`, `{ meta: { a: 1 } }` on a `json` field | no records / one record · the driver's 400 · the driver's 400 | unchanged: reaches the driver as written |

**Who is affected.** A caller that sends a no-operator object beneath a scalar field to the in-memory driver — a test suite, a local or embedded deployment on `InMemoryDriver`, a flow or hook calling the engine in-process — and read the empty answer as a real one. On `SqlDriver` the same filter was already a 400, now in the engine's words; at the per-aggregation `filter` and `having` it was a silent count of 0 or an empty group set on every driver. No existing test in `@objectstack/objectql` or `@objectstack/rest` sent the shape: both suites pass with no fixture changed.

**Unchanged.** A relation field (`lookup`, `master_detail`, `user`, `tree`, single or multiple) keeps its nested-relation form, and a structured-JSON field (`json`, `composite`, `address`, …) its object comparand; both reach the driver as written, which answers them as before. File and media fields, `formula` (refused one door earlier, `INVALID_FIELD`), undeclared keys, a `{ $field }` reference and every operator bag are not judged by this refusal. A `Map` or a class instance keeps the comparand-type door's refusal in its own words.
