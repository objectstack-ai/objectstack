---
'@objectstack/lint': patch
---

fix(lint): `validate-flow-template-paths` resolves flow-variable template roots, and gates the record trigger on the `record` root alone (#17305)

The build-time guardrail against a template token that renders a silent empty
string could resolve exactly one root — `record` — and skipped any flow that was
not record-triggered. Both limits hid the failure it exists to catch, and both
are resolvable from the authored metadata alone:

- A `get_record` node declares `objectName` **and** `outputVariable` in one
  config, so the name it binds holds a record of a known object. `limit > 1`
  switches the executor to a multi-record read, so that name holds an array and
  is tracked as a list rather than a record root.
- A `loop` declares `collection` **and** `iteratorVariable`, so when the
  collection names one of those lists, each element is a record of that object.

`{caseRecord.owner_id.manager}` (a `get_record` output) and
`{currentCase.owner_id.manager}` (a `loop` iterator) are now judged by the same
two rules `{record.<lookup>.<field>}` already was — `flow-template-unknown-field`
and `flow-template-lookup-traversal` — at the same position-based severity: an
`error` inside a filter-guarded CRUD node's `filter` (the node refuses to run,
framework#3810), a `warning` everywhere else.

The record-trigger gate now applies to the `record` root alone. A `schedule`
flow's `get_record` output is as statically typed as a record-change flow's, so
such a flow is no longer skipped whole; `{record.…}` on it stays unjudged
exactly as before.

**Newly reported, not newly refused by anything else.** No authorable key
changes, no export is added or removed, and no shape that parsed stops parsing.
What changes is that a flow whose template reaches through a variable can now
produce a finding. A root resolves only when nothing else in the flow can bind
that name — an assignment target, another node's `outputVariable`, an
`indexVariable` / `errorVariable`, a node id, or a trigger field flattened to
top level all make it ambiguous, and ambiguous stays silent. A `flow.variables`
declaration is deliberately **not** a second binder: it declares the slot the
node then fills, which is the shape `examples/app-todo`'s sweep flows ship.
