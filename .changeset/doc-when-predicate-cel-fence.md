---
'@objectstack/lint': minor
---

Judge `visibleWhen` / `readonlyWhen` / `requiredWhen` examples in the docs corpus
as CEL — where the enclosing structure says which layer they are about

`{/* os:check */}` blocks are type-checked by `tsc --noEmit`, and every CEL
string is the same type as every other CEL string, so
`visibleWhen: "record.status != 'closed' && user.hasRole('admin')"` type-checked
perfectly. `hasRole` is a CEL function that exists nowhere — it is in no stdlib
registry and on no contract — so the predicate faults at runtime, and a
field-level `visibleWhen` fault is fail-**open**: `resolveFieldRuleState`
evaluates visibility with `fallback: true`, so the element the author wrote the
predicate to hide is shown to everyone who copies the page. That is not a
hypothetical shape — a shipped doc taught it (#11034 fixed the instance).

`check:doc-formula-expressions` gains this as a third scan surface rather than a
second gate, because two gates with opinions about one contract is the thing
Prime Directive #12 exists to prevent. The verdict is imported whole: syntax, the
unknown-function catch and the bare-reference rule come from
`@objectstack/formula`'s `validateExpression`, and the closed-root rule comes
from `fieldRuleRootIssue` — the same two the metadata walk applies to the same
slot, in the same order, in the same words.

**The layer is decided first, and a layer that cannot be decided is skipped and
printed.** `visibleWhen` is one key spelling several unrelated contracts, and the
binding root really does differ: an object field binds `record` + `previous`
(+ `parent`), a per-option predicate binds `record` plus the host predicate scope
including `current_user`, a page component binds the user roots and `app`, and a
flow-screen field **flattens its own field names to top level**. A gate keyed on
the key alone would have gone red on
`content/docs/automation/flows.mdx`'s correct `visibleWhen:
'createOpportunity == true'` and on `content/docs/ui/pages.mdx`'s correct
`'sales_manager' in current_user.positions` — and a gate whose reds are wrong is
worse than no gate, because it teaches people to add ignores.

So admission is structural and schema-backed, never keyed on the key: a
`Field.*({ … })` factory call, or a raw field definition carrying `type:` inside
an object-literal `fields:` **map**. The map-versus-array test is the load-bearing
half and it is read off the schemas — `ObjectSchema.fields` is
`z.record(name, FieldSchema)` while `FormFieldSchema` and `ScreenFieldConfigSchema`
are both `z.array(…)`, so a `fields:` map is the object-field layer and nothing
else, and a `fields:` array is exactly the case that cannot be told apart.

**The skip list is printed and counted on every run, including green ones.** A
gate that skips in silence is the same false-green one level up, so the summary
names every skipped site and why. Measured on the corpus as it stands: 23
text-level `*When:` occurrences, of which 13 are admitted and judged, 7 are
listed as skipped, and 3 are the ADR quoting `field.zod.ts`'s schema
(`visibleWhen: ExpressionInputSchema.optional()`) rather than authoring a
predicate. Three of those seven were invisible to an AST-only walk — a bare
`visibleWhen: "…"` line at statement position is a labelled statement, not a
property — so a text-level tripwire reconciles the two counts and any site the
parser never surfaced is listed rather than dropped.

`@objectstack/lint` newly exports `fieldRuleRootIssue` and
`FIELD_RULE_BOUND_ROOTS`. The field-rule root decision was a closure inside
`validateStackExpressions` — correct while it had one caller, and exactly how a
second caller comes to own a dialect of a rule instead of the rule. Behaviour is
unchanged: the metadata walk now calls the extracted function and its 2271 tests
pass untouched.
