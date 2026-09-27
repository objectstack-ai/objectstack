---
"@objectstack/objectql": minor
---

fix(objectql)!: a per-aggregation `filter` (`aggregations[i].filter`) on `engine.aggregate` takes the doors `where` takes — the temporal-comparand door, a `{ $field }` referent that must be a declared field, and the `addDays` class rule — and a `Date` bound is compared as an instant, as it is in `where` (#20148)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) this change adds no transition to migrate. Each refused input is one this position never evaluated as written: it answered a count by coercion (usually zero, every row under a negation), while the same condition as a `where` was already refused, by the engine's temporal-comparand door or by driver-sql's cross-field compiler. There is no accepted spelling a refused input can be mechanically rewritten to: which date, which declared field, or which pair of temporal fields the author meant is an authoring decision, and the refusal says what the position takes. A stored measure filter reaches this position through the analytics service, which lowers it; there is no stored document for `objectstack migrate meta` to rewrite. The table below records the answer each shape had and has; it prescribes no rewrite. -->

**BREAKING**: this narrows what a per-aggregation `filter` accepts on `engine.aggregate`, and on the REST aggregate query (`POST /data/:object/query` with `aggregations`) that forwards it there. Every refusal below is `INVALID_FILTER` / 400, raised in the engine's per-aggregation loop before any driver is asked for a row, identically on an empty and on a populated table. It ships as `minor` under the launch-window convention for accept-set narrowings.

Measured on the base through `engine.aggregate` and through `POST /data/:object/query`, on `driver-memory` and `driver-sql`, over six rows in three groups, with the same condition written as the call's `where` beside each:

| in `aggregations[i].filter` | before | now |
|:--|:--|:--|
| a comparand a declared temporal field cannot read: `{ placed_on: { $gt: 'not-a-date' } }` on a `date`, the same as an `$in` member, a `$between` endpoint, in the implicit slot, behind a `$or` branch that holds or under `$not`; a preset name (`'last_30_days'`) on a `datetime`; `'noon'` on a `time` | counted as written: no row for the bad bound, only the readable members of the `$in`, every row for the `$between`, held-`$or` and `$not` shapes. The same condition as a `where` was refused | refused by the temporal-comparand door `where` takes, run unchanged on this position, in its words. A `{placeholder}` is stepped around and resolved, as there |
| a `{ $field }` naming no declared field of the object (`{ amount: { $gt: { $field: 'nope' } } }`), a dotted referent, or an `addDays` offset column the object does not declare | no row counted; every row under `$ne`, `$not` or a held `$or`. `driver-sql` refused the same comparison in a `where` | refused |
| `addDays` on a pair `FieldReferenceSchema.addDays` does not declare it for: two numeric fields (`{ amount: { $gt: { $field: 'cap', addDays: 1 } } }`), a numeric referent, a text or a time pair, a `date` against a `datetime`, or an offset read from a column that is not numeric | answered by the evaluator's epoch-millisecond coercion: no row on the fixture, 4 of 6 for the `date` / `datetime` pair. `driver-sql` refused the same pair in a `where` | refused |

The two `{ $field }` rows are refused in the words `driver-sql` uses for the same comparison in a `where`: the message names the aggregation that carries the reference (`aggregations[1].filter`) and the rule, and withholds the fields, the operator and the specific reason. The engine logs the withheld diagnostic at `warn`, once per refusal. A referent is judged against the object's declared field map plus `id`, `created_at` and `updated_at`, the set the REST field gate reads; on a host whose registry holds no field map for the object, nothing is judged.

These refusals run after the walker's own (an unknown operator, a malformed reference), so a filter carrying both gets the walker's refusal first.

Not refused, but answering differently:

- **A `Date` bound is compared as an instant.** `{ opened_at: { $gt: new Date('2026-02-01') } }` against the ISO text a `datetime` column holds counted no row: JS compared the `Date` with the string by coercion. `$ne` and `$nin` counted every row, and a `$between` of two `Date`s counted every row. The same bound in a `where` counted 4 of 6 on both drivers. The comparison now reads the pair through `@objectstack/spec/data`'s `utcInstantMs`, the lift `@objectstack/formula`'s evaluator applies, whenever one side is a `Date` and both sides denote an instant. Every `datetime` row and a UTC-midnight `Date` on a `date` field now count what the same bound counts in a `where`. `having` shares this comparison, so a `Date` bound in `having` keeps the groups its ISO spelling keeps. A `Date` is not JSON, so this reaches in-process callers only. Two readings still differ from a `where`, because the per-row comparison holds no declaration: a `Date` carrying a time of day against a `date` field, which a `where` reads as that UTC calendar day, and a `Date` against a `time` field, which is not an instant and is left as before.

Not changed, measured identical before and after on both drivers: every `where`, `groupBy` and `having` answer outside the `Date` shapes above, and a per-aggregation filter that uses implicit equality, ordering bounds, `$in`, `$between`, `$or`, `{}`, a `{ $field }` between two declared numeric fields, `addDays` between two `date` or two `datetime` fields (literal or read from a numeric column), and a reference to `created_at` or `id`.
