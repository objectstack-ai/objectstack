---
"@objectstack/lint": minor
"@objectstack/cli": patch
---

fix(lint,cli): a filter reference that cannot resolve fails the build, not the run (#3426, #3810)

`validateFlowTemplatePaths` reported every `{record.<path>}` miss as **advisory**,
on the reasoning that an unresolved token renders a blank and the run still
completes. Since #3810 that reasoning no longer holds in one position: inside a
CRUD node's `filter`, an unresolved token does not blank a value, it **deletes
the condition** — and a removed condition matches MORE rows, not fewer. Those
nodes now refuse to execute rather than run a widened query.

So the rule was warning about metadata whose runtime is already decided: `os
validate` printed a yellow line, exited 0, and shipped a flow that cannot run.
Severity now follows the runtime consequence, by position:

- **`filter` of `get_record` / `update_record` / `delete_record` → `error`.**
  These are the three nodes whose filter `resolveNodeFilter` guards. The finding
  says what the runtime will do ("the node refuses to run at execution time")
  and why the build gates rather than warns (an absent condition *widens* the
  query). `os validate` exits 1.
- **Every other position → `warning`, unchanged.** A message body, an `http`
  url, an `update_record` write payload: the token still renders a blank, the
  run still completes, and the head object may legitimately come from another
  installed package. `create_record` is deliberately excluded from the gating
  set — it writes a payload and has no filter to widen.

Both rules split this way (`flow-template-unknown-field` and
`flow-template-lookup-traversal`), so a typo and a lookup hop are gated wherever
the runtime refuses them. A reference used in both positions on one node is
reported **once, at error severity**.

**`os validate` now enforces it.** The command filtered this rule's findings for
`severity === 'warning'` and dropped everything else on the floor, so an error
from it would have been invisible. It now gates on errors first — printing rule
id and config path, and emitting them under `errors` in `--json` — mirroring the
`validateReadonlyFlowWrites` step directly below, which makes the same
shift-left split (a certain runtime failure gates; a state-dependent one
advises).

Verified against the shipped examples: 33 flows across app-todo, app-crm and
app-showcase produce **no new errors**; the four pre-existing lookup-traversal
warnings sit in `script` / `notify` / `subflow` / `parallel` positions and keep
their advisory severity.

No authoring change is required for a correct filter. A filter that this rule
now fails is one the runtime would have refused anyway — the difference is that
you find out at `os validate` instead of at 3am.
