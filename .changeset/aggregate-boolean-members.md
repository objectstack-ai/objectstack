---
"@objectstack/spec": minor
---

feat(spec): `AGGREGATE_FIELD_TYPE_COMPATIBILITY` accepts `boolean` / `toggle` for `sum` / `avg` / `min` / `max` — ruling #11152 (booleans aggregate as numbers on every backend) stands over batch #59's blanket default (#16685)

The aggregate × field-type table declared by `@objectstack/spec/data` gains the boolean class (`boolean`, `toggle`) on its four arithmetic / order rows. Two maintainer rulings collided on that class: decision batch #59 (2026-09-06) said "every other pair: refused" without ever naming booleans, while ruling #11152 (2026-08-28) pins that booleans aggregate as NUMBERS on every backend with no per-aggregate exception — `sum(flag)=3`, `avg(flag)=0.5`, `min(flag)=0`, `max(flag)=1`, enrolled on six backends by the spec's own `AGGREGATION_CASES`, and implemented by `driver-sql`'s Postgres cast (#11635). The director ruling of decision batch #80 (2026-09-08, #16685, maintainer verbatim 「其他同意」, option A) holds that the specific ruling stands over the blanket default: the four rows carry both boolean members, and nothing else moves — `AGGREGATION_CASES` and the driver cast are untouched.

| Aggregate | Accepted field types |
|---|---|
| `count`, `count_distinct` | every `FieldType` |
| `sum` | `number`, `currency`, `rating`, `slider`, `progress`, `summary`, **`boolean`, `toggle`** |
| `avg` | the numeric class (`percent` included), **`boolean`, `toggle`** |
| `min`, `max` | the numeric class, `date`, `datetime`, `time`, **`boolean`, `toggle`** |
| every other pair | refused |

Why it matters: `avg(flag)` is the win-rate / SLA-violation-rate shape (#11065) — the reason the conformance table exists. A compatibility table refusing it would refuse a pair every backend is REQUIRED to answer, and the two consumer legs that execute this table (the compile-time refusal in the dataset compiler, #16099, and the authoring-time lint rule) would have turned a supported measure into an authoring error.

**Additive, `minor`.** No export is added, removed or renamed (`dist/*.d.ts` is byte-identical: the table's type is unchanged, only its value gains members), and the accept set only WIDENS — every pair accepted before is still accepted. It rides the same release as the table's own changeset, so the version outcome is the same either way; `minor` is declared because widening a published accept set is the same class of change the table's introduction was (decision batch #35 puts additive widening at `minor`), and because the two consumer legs are the change's real audience: a measure over a boolean field compiles and lints clean.
