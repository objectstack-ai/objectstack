---
"@objectstack/driver-mongodb": patch
---

fix(driver-mongodb): a boolean aggregand answers the ruled values (#11151)

`sum` and `avg` over a **boolean** column answered `0` and `null` on this
driver, where every SQL dialect (#11635), `driver-memory` (#11065) and
objectql's in-memory fallback already answered `3` and `0.5` over the same
3-true/3-false rows. The lowering passed the boolean straight to MongoDB's
`$sum` / `$avg`, which are arithmetic accumulators and ignore every non-numeric
value: with nothing numeric to fold, `$sum` returns its identity `0` and `$avg`
returns `null`. Both arms now wrap the aggregand in the boolean-only `$cond`
coercion #11065 landed, so a rate measure over a flag column reads the same on
this driver as on the others.

**⛔ `min` / `max` are deliberately NOT coerced.** They are order statistics
over BSON canonical comparison order, which ranks booleans and returns a member
of the input domain — #11249 ruled they answer `false` / `true`, and coercing
them would have answered `0` / `1`, breaking that contract in the opposite
direction from the defect being fixed. Their lowering is unchanged; a pin reads
the emitted stages to keep it that way.

**The coercion stays boolean-only.** `null`, a missing key and a non-numeric
string reach the accumulators exactly as before and stay excluded. Widening to
the other half of objectql's `toNumber` — which maps a non-numeric string to
`0` — would average garbage as zero rather than excluding it, a separate
question this change does not open; a control pins the exclusion.

**Why `patch` and not `minor`.** This changes what an existing operation
returns, which ordinarily argues for `minor`. It is graded `patch` because the
returned values were **already ruled** before this change (#11065 for the
arithmetic pair, #11249 for the order statistics) and are stated as shared
values in `@objectstack/spec/data`; every other face already produced them, and
the sibling repair on `driver-memory` shipped as a patch. There is no new API,
no option, and no opt-out to describe — nothing here is a feature, and the only
behaviour a consumer could have depended on is a value this project has ruled
wrong and that no other driver produces. Calling it `minor` would advertise a
capability that does not exist and imply the old answer had standing.

Not user-visible, and shipped in the same change because the two are one cell:
`mongodb-pipeline-evaluator.testkit.ts` — the server-free instrument that holds
this lowering to the shared table — applied its "arithmetic accumulators ignore
non-numeric values" filter to `$min` / `$max` as well, one arm too far, and so
answered `null` for them over a boolean column while the lowering under test was
correct. Those arms now ignore only null and missing, compare by BSON canonical
order, and refuse a type the evaluator does not rank instead of silently
answering `null`.
