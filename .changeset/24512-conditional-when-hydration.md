---
'@objectstack/objectql': minor
'@objectstack/lint': minor
---

fix(objectql,lint)!: a `conditional` validation rule's `when` reads one hop through a reference, the way a rule's `condition` does

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape, export or authorable spelling is added, removed or renamed, so there is nothing for `objectstack migrate meta` to rewrite. A rule keeps its authored shape. What changes is how a `conditional` rule's `when` is judged: the engine now serves it one hop through a reference (it read the bare id before), and the validation-rule pass judges its hops as it judges a `condition`'s. Both narrow: the save door refuses four `when` shapes it accepted, and the runtime refuses a write it judged on an empty reference under a null-safe `when`. -->

**BREAKING** (an accept-set narrowing, at the save door and at write time), shipped as `minor` under the launch-window convention for breaking changes.

A `conditional` rule's `when` that reads through a lookup (`record.account.status == 'active'`) now works. The engine loads the related row for it, as it does for a `script` or `cross_field` rule's `condition`, and `when` picks `then` or `otherwise` on that row. Before, `when` met the stored id, so the read faulted and every write the rule guarded was refused with "The when-predicate reads 'status', which this object does not declare". A `when` nested in a `then` or `otherwise` is served the same way. A sibling rule keeps its own verdict when a `when` cannot be evaluated.

`@objectstack/objectql`, at write time:

- FROM: `when: record.account.status == 'active'` refused every write it guarded as unevaluable. TO: it is judged on the related row.
- FROM: a null-safe spelling (`record.account.?status.orValue('') == 'active'`, `has(record.account.status) && …`) read the stored id and silently took `otherwise` for every account. TO: it is judged on the related row.
- FROM: on a write whose reference is empty, a null-safe `when`, or one that tests `record.account != null` in the same expression, evaluated to false and judged `otherwise`. TO: the write is refused (`400 VALIDATION_FAILED`, `_record` `rule_violation`), as a `condition` reading through an empty reference is. The refusal names the guard.
- A `when` that reads a second hop, a field the related object does not declare, or the reference both through it and as a value is refused with a sentence that names the related object and field, instead of the generic one. A `when` that faults on a delete's reference cleanup names the delete, as a `condition` does.
- The guard spelling `when: record.account != null` reads the stored id, as before.

`@objectstack/lint`, where a rule is written: `os validate`, `os build` and the object save door (`PUT /api/v1/meta/object/:name`) run the same pass, under the existing `EXPRESSION_INVALID` rule. They now judge a `when`, top level and nested, with the checks a `condition` gets. Each of these saved before (`200`) and is refused now (`422 INVALID_METADATA` at the save door), located at the `when` slot. At run time each refused every write it guarded, and the third also took `otherwise` on an empty reference:

- FROM: a second hop (`record.account.owner.email != null`), saved. TO: refused.
- FROM: a field the target does not declare (`record.account.region == 'north'`), saved. TO: refused, "unknown field `region` on `<target>`".
- FROM: the reference read both through it and as a value (`record.account != null && record.account.status == 'active'`), saved. TO: refused, naming the guard.
- FROM: a hop into a stored-metadata-body table, saved. TO: refused.

What to do. To skip a rule while the reference is empty, keep the reference test in its own `when` and nest the rule that reads through it: a `conditional` whose `when` is `record.account != null`, with your `conditional` as its `then`. To refuse an empty reference, make the field `required: true`. Read a field the target declares, and read one hop.
