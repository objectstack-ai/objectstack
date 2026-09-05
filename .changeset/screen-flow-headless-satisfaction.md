---
"@objectstack/service-automation": minor
"@objectstack/runtime": minor
---

A screen flow can now be completed by a headless caller, and `list_actions` publishes its input names.

An `ai.exposed` action whose target is a **screen flow** could be started over MCP and never finished. `run_action` seeded the flow's `isInput` variables from the caller's `params` — correctly — and the screen node suspended anyway, because the only inputs to that decision were "does the node declare fields" and the author's `waitForInput` flag. The MCP tool set has no verb to resume a parked run, so `ai.exposed` meant "the agent can invoke this", not "the agent can complete this". The fallback an agent took instead — re-implementing the flow's tail with `create_record` + `update_record` — bypasses whatever business rules the flow encapsulated.

Two independent halves:

- **A screen the caller already answered no longer pauses.** When the caller named at least one of the screen's own fields and every `required` one has a value from that caller, there is nothing left to collect and the run continues. Optional fields may come from anywhere (including a declared `defaultValue`).
- **`list_actions` publishes a flow action's inputs.** A `type: 'flow'` action's contract is its target flow's `isInput` variables, not `action.params`; those are now surfaced in declaration order with the `label`, `type`, `required` and select `options` of the screen field that collects each one. An action that declares its own `params[]` keeps them — the flow is read only where the action declared nothing.

**Interactive runs are unchanged.** A console launch carries the record it was launched from and that record's id — never a value for the screen's own fields — so the form renders exactly as before. That covers both shapes a launch actually supplies: a subject-record column named like one of the screen's fields, and a field named like one of the row-id keys the dispatch doors seed (`recordId`, the camelCase `<object>Id` alias, an action's declared `recordIdParam`), none of which counts as the caller answering the screen — the two fixed names outright, and any value equal to the launched row's id whatever key carries it. One accepted cost of that: **a screen field named `recordId` or `<object>Id` is always collected interactively**, even from a headless caller. Two screens never take the new path, because they declare nothing to satisfy and must not be answered vacuously: a message-only screen (no fields), and any screen whose author wrote `waitForInput: true`. `waitForInput: false` remains the wrong tool for the headless case — it skips the form for interactive users too.

⚠️ One known gap, on the trigger-record leg only: a run continued from the **durable** suspended-run store judges against a JSON copy of its context, so a later wizard screen whose field collides with a **non-scalar** column (an array or object) of the trigger record can read as caller-supplied and be skipped. Scalar columns are unaffected, as is any run that has not been through a pause.

⚠️ This does **not** make every screen flow completable over MCP. A call that omits the inputs still parks, and nothing on that surface can resume it; that half is a resume verb and is not this change.
