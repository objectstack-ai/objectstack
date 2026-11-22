---
'@objectstack/scenarios': patch
---

feat(scenarios): a scenario card names the agent action an operation goes through (`via`)

Clause-②: yes (widening) — `OperationSchema` (exported from the package's `.` entry, and through it `ScenarioCardSchema`) accepts an optional `via`; `PersonaGrantNeed` (the `./score` entry) gains `routedVia`
Metadata-protocol: none

- A card operation may name, as `via`, the card's own agent action the write is designed to go through (one of `run.agentActions` on the operation's object). The loader refuses a `via` that is not such an action, and a `via` on a `refused` operation.
- The Build check `persona-grant:<persona>:<object>:<verb>` is not measured, never a pass, when the persona's set withholds the verb and every operation needing it names a `via` action the build declares (or, as before, waits on confirmation behind the card's confirm-gated action the build declares). A set that grants the verb still passes; an operation without `via` is graded as before.
- leave_balances `manager_approves_step_one`, requisition_to_receipt `manager_approves_level_one` and travel_expense `manager_approves_step_one` name `decide_approval_step` as their route.
- Card data: order_to_cash's PAY-0044 is paid on 2026-10-02, not 2026-10-01, so no payment sits on the day the platform's `last_30_days` preset counts and the card's 30-day window does not (`collected_by_team_last_30_days` west is now 58300).
