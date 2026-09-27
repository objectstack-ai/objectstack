---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol)!: the read door judges the keys inside each per-aggregation `filter` with the gate an explicit `where` meets — an unknown key is `INVALID_FIELD` / 400, not a count of zero (#20148)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) this change adds no transition to migrate. A per-aggregation filter key that names no field of the object never had a meaning: no row carries it, so the aggregation read "no value" in every row and counted zero, or every row under a negation, while the same key in `where` was already refused by this gate. There is no accepted spelling it can be mechanically rewritten to: which field the author meant is an authoring decision, and the refusal names the key and suggests the nearest declared field. The gate is the one `where` already meets, with the same verdicts. The request is not a stored document, so there is nothing for `objectstack migrate meta` to rewrite. The table below records the answer each shape had and has; it prescribes no rewrite. -->

**BREAKING**: this narrows what `POST /data/:object/query` (`findData`) accepts in `aggregations[i].filter`. Each entry's filter now goes through the gate the explicit `where` meets, `assertFilterFieldsExist`: the same field set, the same verdicts, `INVALID_FIELD` / 400, with the entry's position as the parameter (`aggregations[1].filter`). The refusal is raised before the engine is called. It ships as `minor` under the launch-window convention for accept-set narrowings.

Measured on the base through `POST /data/:object/query` on `driver-memory` and `driver-sql`, over six rows in three groups:

| in `aggregations[i].filter` | before | now |
|:--|:--|:--|
| a key naming no field of the object (`{ nope: 1 }`), also under `$and` | `200`, that count 0 | `INVALID_FIELD` / 400, naming the key |
| the same key under `$ne`, `$not`, or behind a `$or` branch that holds | `200`, every row counted | `INVALID_FIELD` / 400 |
| an unknown key carrying an unknown operator (`{ nope: { $median: 1 } }`) | `INVALID_FILTER` / 400 from the engine | `INVALID_FIELD` / 400: the field gate runs first, as it does for the same key in `where` |
| a dotted key on a scalar head, or a key naming a `formula` field | `INVALID_FIELD` / 400 from the engine's own filter seam | `INVALID_FIELD` / 400 from this gate, in the words `where` gets |

Run after the entry checks and the aggregated-field check, so an entry the spec cannot read keeps its shape refusal and an unknown aggregated `field` keeps its own. A filter that is not a plain object names no key here and is left to the engine's shape gate.

Not changed: a filter on declared keys, on `id`, `created_at` or `updated_at`, and a relation head in the nested-object form reach the engine with the filter untouched.
