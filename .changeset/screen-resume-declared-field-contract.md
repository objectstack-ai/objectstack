---
"@objectstack/spec": patch
"@objectstack/service-automation": patch
"@objectstack/runtime": patch
---

fix(automation): `resume` enforces the suspended screen's declared field contract (#4477)

A `screen` node's `config.fields` is a complete input contract — the author
declares the keys, their `required`-ness, and (via `visibleWhen`) when a field
is even asked for. The RENDER half honoured all of it: the paused result and
`GET …/runs/:runId/screen` carry `required` and `visibleWhen` intact. There was
no VALIDATION half — `POST …/runs/:runId/resume` folded whatever bag it was
handed straight into the flow variables, so a caller that skipped the dialog and
posted here directly was unconstrained by every `required` the author wrote.
Missing required fields, and keys the screen never declared, all completed the
run with `success: true`.

Screen flows are the one place where the declared field contract is the ONLY
contract — no object schema sits behind a screen node to catch a bad bag
downstream. The platform already enforces the analogous contract everywhere else
this seam appears: action params (ADR-0104 D2), record writes (ADR-0113),
approval `decisionOutputs` (#3447). This is that rule for screen resume, built in
the same shape.

`resume` now refuses a non-conforming submission with the new
`AutomationResult.code` `'INVALID_SCREEN_INPUT'` (a transport maps it to **400**,
as the automation domain route now does) and an `Invalid screen input: …` message
that names each violation and lists the declared field names. The refusal happens
BEFORE the suspension is consumed, so the pause stays live and the legitimate
submission still lands.

`visibleWhen` is evaluated against the SUBMITTED values first (layered over the
run's variable snapshot), so a hidden field's `required` never fires — enforcing
it would dead-end the run at a field the user was never shown, which is #3528
reproduced server-side. A predicate that cannot be evaluated is logged and
treated as hidden rather than visible: the client decides what the user saw, and
a broken predicate is not evidence a field was on screen.

Scope, deliberately narrow — three shapes keep the historical pass-through:

- an **object-form** screen (`kind: 'object-form'`), whose `fields` is empty by
  construction because the client renders the object's own form and the write
  path enforces that object's `required` fields itself;
- a **message-only** screen (`waitForInput: true`, no fields), which declares no
  keys and so constrains none — the same pass-through `enforceActionParams`
  gives a param-less action;
- `signal.output`, the node-OUTPUT namespace, which belongs to the approval-style
  resume envelope rather than to the screen's collected-values channel.
