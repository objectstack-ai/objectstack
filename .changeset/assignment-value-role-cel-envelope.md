---
"@objectstack/spec": minor
---

feat(spec): an `assignment` value may be a CEL value envelope — the expression ledger gains the `value` role

An assignment's whole job is to compute a value into a variable, yet CEL was
reachable from flow metadata only where the answer had to be a boolean
(`condition`, `decision.conditions[].expression`, a screen field's
`visibleWhen`): `FLOW_NODE_EXPRESSION_PATHS` declared two roles, `predicate`
and `flow-template`, and the `assignment` node's values were `{token}`
interpolation only. So the stdlib the platform already declares, documents and
tests — `joinNonEmpty` and the rest of `CEL_STDLIB_FUNCTIONS` — could not be
called from metadata, and the commonest outbound shape a business application
has (one digest message listing a recipient's N records) needed a `script`
node.

Ruled (maintainer, 2026-09-02): the rendering half only, no new vocabulary.

- `FlowNodeExpressionRole` gains `'value'`: a slot whose authored value may be a
  `{ dialect: 'cel', source }` expression envelope evaluated by the expression
  engine to the value the variable takes — not a predicate, not a template.
  The ledger gains the `assignment` entry at `assignments.*`; ledger paths now
  accept a `*` segment ("every key of this object", the sibling of `[]`), and
  `resolveFlowNodeExpressions` emits only envelope-shaped objects for a `value`
  slot — a plain string there stays `{token}` interpolation. Every entry that
  existed before resolves byte-identically. `isExpressionEnvelopeShaped` is
  the exported recognizer both halves discriminate on.
- `AssignmentConfigSchema` / `AssignmentValueSchema` /
  `AssignmentExpressionValueSchema` declare the `assignment` node's value
  contract: a string (`{token}` interpolation), a CEL value envelope (the
  `ExpressionSchema` spelling, narrowed to the `cel` dialect), or any other
  literal. Every value that parsed before still parses; the one newly refused
  shape is a malformed envelope (no `source`, an empty or non-string `source`,
  a `template` / `cron` / unknown dialect), refused at the variable's path with
  a fixed leading sentence. The map value carries `.meta({ xExpression:
  'value' })`, the declaration channel the ledger reads for this slot.

The executor half is a separate change in `@objectstack/service-automation`:
until it lands, the built-in `assignment` executor still writes an envelope
object into the variable verbatim and `notify` renders it as JSON, and the
ledger's reconciliation ratchet there does not yet know the `value` marker.
