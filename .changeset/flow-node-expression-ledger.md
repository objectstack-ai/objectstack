---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/lint': minor
---

Validate the expression slots a flow node's `configSchema` declares (#4027).

A node type's designer `configSchema` and the keys its validators traverse were
two unreconciled lists. Both the engine's `registerFlow` pass and the author-time
`objectstack validate` pass hardcoded `config.condition` / `edge.condition` and
assumed every other node string was a `{var}` template — so a declared expression
property outside that hardcoded set was validated by nobody.

That is how #3528 shipped. `screen.fields[].visibleWhen` has been on the `screen`
descriptor since #3304, typed `xExpression: 'expression'` (bare CEL) and offered
to authors in Studio, but no validator traversed it. An app authored the
predicate in the *other* dialect — `'{createOpportunity} == true'` — and it passed
`tsc`, `objectstack validate` and registration in silence. Because `required` *is*
enforced, a field the author had made conditional rendered unconditionally and
blocked Submit on an input the user was never shown: the run paused forever and no
resume was ever issued.

Now:

- **`FLOW_NODE_EXPRESSION_PATHS`** (`@objectstack/spec`) is the declared ledger of
  expression-bearing node config paths, each recording the dialect it takes.
- **Both validators read it.** A malformed `visibleWhen` is a located, quoted
  error at `registerFlow` *and* at `objectstack validate` — `node 'screen_1'
  (screen) screen field visibleWhen at config.fields[1].visibleWhen`.
- **A reconciliation ratchet** derives the expression properties from the live
  descriptors and fails CI in both directions: a new `xExpression` property with
  no ledger entry, or a stale entry no descriptor declares. It walks every
  registered builtin, not just `screen`.

Dialects are recorded rather than assumed because there are three, and two of them
disagree about braces: bare CEL (`{…}` is the #1491 brace-trap), single-brace
`{var}` flow interpolation (`{…}` is correct), and the ADR-0032 §3 double-brace
text template. Only bare-CEL slots are checked — `loop.collection` and
`map.collection` are recorded as `flow-template` and deliberately left alone,
since no validator implements their dialect and checking them under either of the
other two would reject every currently-valid flow.

`ActionDescriptor.configSchema`'s TSDoc no longer claims `registerFlow()`
validates `config` against it. It never did: `FlowNodeSchema.config` is
`z.record(z.unknown())`, so types, `required`, `enum` and unknown keys are still
unenforced. The doc now states exactly what is checked and what is designer-facing
only, so nothing relies on a guard that does not exist.
