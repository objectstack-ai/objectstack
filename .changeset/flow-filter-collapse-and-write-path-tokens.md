---
"@objectstack/objectql": minor
"@objectstack/service-automation": minor
"@objectstack/spec": patch
"@objectstack/lint": patch
---

fix(automation,objectql): a filter that loses a condition must not run (#3810)

Three related holes, all of which end in "the query matched rows the author
excluded".

**1. A flow filter could silently widen to match everything.**

The flow template interpolator expresses "this token did not resolve" as
`undefined`. In a message that renders as empty text — harmless. In a FILTER it
removes the condition, and a removed condition matches MORE rows. When it was
the only condition, `{ owner: '{record.ownr}' }` became `{}`, and `{}` handed to
`deleteMany` is every row in the table.

So one mistyped field name in a `delete_record` node silently emptied the
object. Reproduced with all four causes: a typo (`{record.ownr}`), an input the
run never received, a lookup hop (`{record.account.name}` — the trigger record
carries a scalar id), and a filter placeholder.

`get_record` / `update_record` / `delete_record` now refuse to execute when
interpolation erased any authored condition, naming the offending template. The
guard keys on LOSS, not emptiness: an author who deliberately wrote no filter is
unaffected, and losing one of two conditions still fails, because widening from
"my open records" to "all open records" is the same class of bug.

**2. Filter placeholders never reached the engine that resolves them.**

`config.filter` is where two `{…}` dialects meet — the flow template dialect
(`{record.owner}`) and the filter placeholder dialect (`{current_year_start}`,
`{current_user_id}`, resolved by `resolveFilterTokens()`). Evaluation order
picked the winner by accident: the flow interpolator ran first, found no flow
variable by that name, and erased it.

`interpolateFilter()` hands that position back to the dialect that owns it — a
whole-string token that no flow variable resolves and that IS a recognised
placeholder passes through verbatim for the engine to expand. Flow variables
keep precedence, so a template that works today cannot change meaning.

**3. The engine resolved placeholders on reads but not on writes.**

`resolveFilterTokens()` reached `find`/`findOne`/`count`/`aggregate` only. So
the SAME filter selected different rows depending on the verb: `find({ owner:
'{current_user_id}' })` matched the signed-in user's rows, while
`update`/`delete` compared the literal token text and matched none — a flow that
previewed with one and acted with the other operated on two different row sets.
This is the #3106 shape one layer down: the evaluator existed, only some call
sites reached it.

`update` and `delete` now resolve too, BEFORE the by-id fast path claims a
scalar `where.id` (otherwise an unresolved `{current_user_id}` would be bound as
the primary key itself). Caller options are never mutated.
