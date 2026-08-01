---
"@objectstack/spec": minor
---

feat(spec): a solution blueprint can declare a roll-up, including a conditional one

`BlueprintFieldSchema` gains `summaryOperations` (object / function / field /
relationshipField + a predicate), in both the lenient schema and the strict
structured-output mirror. Without a slot for it, a blueprint `summary` field
could only ever be proposed as a bare shell: `z.object` strips unknown keys, so
a blueprint that correctly declared `{ type:'summary', summaryOperations:{
object:'task', function:'count', filter:{ status:'completed' } } }` lost that
config at the parse waist and materialized runtime-dead — and the design step,
the one place the aggregation is actually known, had nowhere to put it.

It has to be declarable at design time: the engine recomputes a roll-up only
when a CHILD row is written, so operations added after a build's sample data
loaded leave every parent value empty until someone edits a child.

Strict mode cannot represent the canonical `filter` map (open-ended
`additionalProperties`), so the predicate is a flat `conditions` array of
`{field, op, value}` — the shape a dashboard widget's `condition` already uses;
the lenient schema also accepts a real `filter` map for a hand-authored
blueprint. `BlueprintWidgetConditionSchema` is now an alias of the shared
`BlueprintConditionSchema`.

Also makes the lenient schema's top-level `summary` optional. It is a purely
descriptive one-liner with no structural role, but it is what `apply_blueprint`
parses the model's re-emitted blueprint against — omitting it rejected the whole
build with `path: "summary"`, which an agent read as "the summary FIELDS are
invalid" and repaired by deleting the roll-up fields. The strict design contract
still requires it.
