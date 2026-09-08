---
"@objectstack/lint": minor
---

New gating rule `flow-filter-token-unknown`: a `{…}` filter token in a flow node's `config.filter` that NEITHER `{…}` dialect can resolve is now an authoring-time `error`.

`filter-token-unknown` walks seven presentation collections and not `flows`, so `{TOMORROW()}` in a list view's filter failed the build while the identical string in a flow node's `config.filter` was silent — even though this package's other filter rules (`empty-combinator`, the preset-comparand rules) have reached flows all along.

The gap was not an oversight to close by adding a root. A flow node's filter is interpolated by the automation template evaluator **before** ObjectQL sees it, and only what that evaluator cannot resolve is handed on. Judging a flow filter against the ObjectQL vocabulary — the obvious one-line fix — reports every legitimate `{record.id}` and `{recordId}`: measured at **7 findings, all 7 false positives**, on this repo's own example apps. So the new rule is a second rule id with the flow dialect as its reference set, and `filter-token-unknown`'s surface list is untouched.

Reported (`error`): a call to a name in neither table — `{TOMORROW()}`, `{ROUND(x)}`, `{Math.round(x)}`, `{DATEADD(day, -45)}`. The flow template dialect's function vocabulary is closed (`round` / `floor` / `ceil` / `abs` / `min` / `max`, plus the whole-token `NOW()` / `TODAY()` with an optional `± N` day offset), and the evaluator already raises a guard refusal on anything else — so the node cannot run at all, and the build was shipping a flow whose runtime was already decided. This is the same severity axis `flow-template-unknown-field` applies at this exact position.

Silent, deliberately: `{TODAY() - 45}` and every other whole-token date form; `{$User.Id}`; `{current_user_id}` / `{today}` / `{30_days_ago}` and the rest of the filter placeholders; and every bare or dotted identifier (`{recordId}`, `{record.id}`, `{currentTask.id}`), which addresses the run's variable map — declared flow variables, node outputs, and the trigger record's own fields — and is not decidable from authored metadata.

Finding delta on this repo's example apps: **0**. Expect a new `error` only where a flow filter calls a function the evaluator would refuse at run time.
