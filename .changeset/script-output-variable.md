---
"@objectstack/service-automation": minor
---

feat(automation): script-node `outputVariable` + interpolated inputs — the pure-function pattern (#1870)

A flow `function` (script node) is a PURE compute step: it receives `ctx.input`
and RETURNS a value. Two additions make the value usable on the flow graph
without giving functions raw data access (which would hide I/O from the graph
and bypass governance):

- `config.outputVariable` exposes the function's return value as a flow variable,
  so a later declarative node persists it (`update_record fields: { x: '{ai.x}' }`).
- `config.inputs` are now interpolated against the live flow variables, so a
  function can consume a prior node's output (`inputs: { id: '{record.id}' }`).

Data writes stay declarative (visible, governed, build-checkable); data-lifecycle
side effects belong in L2 hooks (which get `ctx.api`), not flow functions.
