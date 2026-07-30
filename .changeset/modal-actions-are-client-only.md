---
'@objectstack/example-todo': patch
---

**[#3959] `app-todo`'s `defer_task` / `set_reminder` are `type: 'script'`, not `type: 'modal'`.**

Both declared `type: 'modal'` with a `target` naming a modal page that does not
exist (`defer_task_modal`, `set_reminder_modal`), while their handlers sat
registered under `deferTask` / `setReminder` — keys no declaration could
address. A `modal` action has no server dispatch (`headlessActionTypeError`
rejects it over REST), so neither handler had ever executed: the example
shipped business logic that could not run, and ADR-0110 D5's boot inventory
flagged both on its first pass.

Both already declared the `params` their handlers read, so they were always
"collect input, then run server-side" actions — which is `type: 'script'` with
`params`. The runner collects the same dialog and the handler now actually runs.

The action-type table in `content/docs/ui/actions.mdx` said `modal` meant
"collect input, then submit to a handler", contradicting the same page's own
REST table (`modal` → 400, nothing for the server to run). Corrected.
