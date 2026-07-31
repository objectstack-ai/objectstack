---
"@objectstack/lint": minor
"@objectstack/spec": patch
---

feat(lint): a flow `update_record` node writing an undeclared field gates the build (#4271)

The write-set family #4305 (hooks) and #4344 (actions) opened had a third
surface, and it was the one the docs had spent the longest recommending as the
safe alternative to the other two. A flow `update_record` node whose
`config.fields` names a field the target object never declares was caught by
**nothing**: `validate-readonly-flow-writes.ts` walks that exact map and
explicitly stepped over the unknown key (`if (!meta) continue; // a
form/field-layout lint concern` — a referral to a rule that does not check
writes), and `validate-flow-template-paths.ts` checks the `{record.<path>}`
READ tokens interpolated into node config, never the write-side key. So the
surface `hook-bodies.mdx` pointed authors at — "prefer a flow `update_record`
node, whose structural `fields` config is checked" — was the least checked of
the three.

**New rule — `flow-node-write-unknown-field`, and it is an `error`.** Wired into
`REFERENCE_INTEGRITY_RULES`, so `os validate`, `os lint` and `os compile` report
it at once (one more place than the hand-wired readonly rule next door reaches).

**Why it gates where its two siblings advise.** The hook and action rules are
advisory because they PARSE JavaScript: the finding is only as good as the
extractor, and a false positive kills an advisory lint. Nothing here is parsed —
`config.fields` is a literal map next to a literal `objectName`, the same
certainty `flow-update-readonly-field` already gates on one config key over. A
rule that errors on a write the engine *strips* while only warning on a write
that names no column at all would be incoherent in the same `fields` map.

And the runtime consequence is not the benign "consumer skips the unknown name
and renders the rest" that keeps `page-field-unknown` / `form-field-unknown`
advisory. Both halves were measured, not inferred:

- Through the engine, an undeclared key reaches `driver.update` verbatim — the
  flow executor calls the data engine directly, the UPDATE path strips only
  readonly/readonlyWhen, and the SQL driver's `formatInput` /
  `applyWriteColumnMap` pass an unrecognized key straight through (`m[k] ?? k`).
- On SQLite/knex it becomes `update "deal" set "name" = 'n2', "stagee" = 'won' …
  → no such column: stagee`. The statement is rejected **whole**: `name` —
  spelled correctly, in the same payload — does not land either, and the step
  fails with a driver error naming a column, far from the authoring mistake.
- On a schemaless datasource nothing rejects it, so the stray key is persisted
  into a column the object never declares, where no schema-driven read returns
  it.

That is the call `validate-searchable-fields` makes for a stale entry and
`validate-flow-template-paths` makes for a filter-position token: gate when the
miss breaks or corrupts the operation, advise when it merely narrows the output.

**One field index and one implicit-field set across all three surfaces.**
`indexObjectFields` and `IMPLICIT_FIELDS` are imported from the hook rule rather
than copied, so the three rules cannot drift on what is writable without being
authored — the shape #4330 collapsed one package over.

Every skip exists so the gate only ever fires on a certainty, and each is
silent: a templated `objectName`, a non-literal `fields` map, an object this
stack does not define, an object that declares no fields at all (external /
datasource-introspected schemas, the same skip `validate-searchable-fields`
takes), and dotted keys (a nested-path write, not a top-level column). `runAs`
is deliberately NOT consulted, unlike the readonly rule that skips
`runAs:'system'` — an elevated identity bypasses the readonly strip, but no run
identity conjures a column.

**Scope is declared as data, not left as silence.** `FLOW_WRITE_NODE_TYPES`
(today `update_record`) and `FLOW_WRITE_NODE_TYPES_DEFERRED` (`create_record`,
with its reason) are partition-tested against the CRUD node types that carry a
`fields` write map — derived behaviourally from the spec's executor-written
config schemas, not restated — so a node type that grows one later fails that
test until someone classifies it.

`@objectstack/spec`: `ScriptBodySchema`'s "prefer a flow `update_record` node,
whose structural `fields` config is error-checked" note now names the rule that
makes it true. Doc comment only — no schema or generated-artifact change.

Docs: #4355 had just rewritten `automation/hook-bodies.mdx` to record this gap
honestly — "**Prefer a flow `update_record` node when the write set is fixed —
but not for *this* check** … writing a field the object never declares is
currently reported by nothing at all. On that one axis an L2 body is now the
better-checked surface." That bullet, and the matching note in
`automation/hooks.mdx`, are the two sentences this change makes false. Both now
say the axis has flipped back — and why the flow side lands a level *stronger*
than the body side rather than merely level with it.
