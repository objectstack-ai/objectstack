---
"@objectstack/objectql": minor
---

fix(objectql)!: a plain object with no `$` operator beneath a relation field, a structured-JSON field or an undeclared `id` column is refused with `INVALID_FILTER` / 400 at `where`, a per-aggregation `filter` and `having`, on every driver

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of filter STRUCTURE at the engine's query door, the same door and category as the scalar-field refusal it extends: a plain object with no `$` operator key beneath a relation column (the nested-relation form), a structured-JSON column (a whole-value match) or a platform-provisioned column the declared map omits. No authorable key, spelling, export or stored shape moves (the door modules are internal; `@objectstack/objectql` exports nothing new and nothing less, and `FilterCondition` keeps parsing the form), and no stored row is read or rewritten. The nested-relation form could match no record on the in-memory driver and was refused by the SQL driver, and which related records a caller meant is not something a ledger entry can rewrite into ids. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a filter's structure (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what a filter may put beneath a relation or JSON-valued field. A plain object with no `$`-operator key — `{ "owner": { "region": "NA" } }` beneath a `lookup`, `{ "meta": { "a": 1 } }` beneath a `json` field, `{}` included — is refused by the engine before any driver is asked. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What an author sees now.** `400 INVALID_FILTER`, naming the field, its declared type, the object's keys (never its values), the position (`where.owner`, `aggregations[1].filter.owner`, `having.owner`) and the route that works, inside the first 500 characters the REST door keeps:

- **A relation field** — `lookup`, `master_detail`, `user`, `tree`, single or multiple (the nested-relation form, a condition on the related record's own fields). No data-path driver follows a relation: the field stores the related record's id. Filter the related object first, then match the field against the ids it returns — `{ "owner": { "$in": ["ID", "..."] } }` on a single-valued field, `{ "owners": { "$contains": "ID" } }` per id on a multi-valued one (an `$or` of those for several ids; the SQL driver refuses `$in` on a multi-valued column). A dotted path (`"owner.region"`) is no route: it was already refused with `INVALID_FIELD` on every driver.
- **A structured-JSON field** — `json`, `composite`, `repeater`, `record`, `location`, `address`, `vector` (a whole-value match). The drivers share no meaning for it: the in-memory driver compared documents, the SQL driver refused the bind. Test the whole value's presence with `{ "meta": { "$null": false } }`, or store the part you filter on in a field of its own and filter that field. `$contains` is no route: it was already refused over a JSON value on every driver.
- **`id`, `created_at` or `updated_at` absent from the declared field map** — the platform provisions these columns, so they are judged by the type they store (text, datetime), in the scalar-field words: compare with a value or an operator.

No mechanical rewrite exists, because which related records or which part of the JSON value the caller meant is not in the object; the fix is by hand, as above.

Measured through `POST /api/v1/data/:object/query`, three rows (owner `u1`, region NA, on `d1` and `d3`):

| position | filter | before: memory · SQLite · PostgreSQL 16 | now, on all three |
|:--|:--|:--|:--|
| `where` | `{ owner: { region: "NA" } }` on a `lookup`, and its `master_detail`, multiple-lookup, `user` and `tree` twins | no records (`d1`, `d3` were meant) · the driver's 400 · the driver's 400 | `INVALID_FILTER` / 400, the engine's words |
| `where` | `{ meta: { a: 1 } }` on a `json` field, and its `address` and `composite` twins | the deep-equal records · the driver's 400 · the driver's 400 | `INVALID_FILTER` / 400 |
| `where` | `{ id: { a: 1 } }` | no records · the driver's 400 · the driver's 400 | `INVALID_FILTER` / 400 |
| per-aggregation `filter` | `{ owner: { region: "NA" } }` | count 0 on all three | `INVALID_FILTER` / 400 |
| per-aggregation `filter` | `{ meta: { a: 1 } }` | count 1 on all three (the engine's own deep equality) | `INVALID_FILTER` / 400, one answer per filter at every position |
| `having` | `{ owner: { region: "NA" } }` over a lookup groupBy | no group on all three | `INVALID_FILTER` / 400 |
| `where` | route `{ owner: { $in: ["u1"] } }`; `{ owners: { $contains: "u1" } }` | `d1`, `d3` on all three | unchanged |

**Who is affected.** A caller that sends the nested-relation form or a JSON object comparand to the in-memory driver — a test suite, a local or embedded deployment on `InMemoryDriver`, a flow or hook calling the engine in-process — and read the empty (or deep-equal) answer as a real one; and a per-aggregation `filter` that matched a JSON value by deep equality. On `SqlDriver` the `where` forms were already a 400, now in the engine's words.

**Supersedes** the "Unchanged" paragraph of the scalar-field refusal entry (`20546-no-operator-object-on-scalar`) for relation and structured-JSON fields: they are judged now, in words of their own. File and media fields (a legacy stored value is an inline object), `formula` (refused one door earlier, `INVALID_FIELD`), any other undeclared key, a `{ $field }` reference and every operator bag are still not judged by this refusal.
