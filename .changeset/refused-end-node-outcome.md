---
'@objectstack/service-automation': minor
---

Flow `end` nodes honour `outcome: 'refused'` — a terminal `refused` run, distinct from `failed`

`packages/spec` has declared the shape since 17.4.0: an `end` node accepts
`outcome: 'completed' | 'refused'`, a `refused` end requires a `message`,
`ExecutionStatus` carries `refused`, and `ExecutionLog` / `AutomationResult` /
the trigger response carry `refusalMessage`. The engine produced none of it —
it returned on every `end` node without reading its config — so an author who
wrote a refusal shipped a plain completion: the run recorded `completed`, the
caller got the flow's `successMessage`, and the authored reason reached nobody.

The `end` node now honours it:

- **The run terminates `refused`.** A refusal is a *successful evaluation that
  says no*, so the result is `success: true, status: 'refused'` with no `error`
  and no `errorMessage` — and, deliberately, no `successMessage`: the flow's
  completion toast is for a completion. All three terminal producers answer
  identically (a triggered run, a resumed screen flow, and an attempt under
  `errorHandling.strategy: 'retry'`, where a refusal also stops the ladder
  rather than consuming retry budget).
- **The `message` is rendered per record**, through the same interpolation a
  `screen` node's `description` gets — one implementation (`interpolateText`),
  never a second template engine — so `'Refused: {record.name} is a confirmed
  duplicate'` reaches the caller naming the record.
- **Both are persisted on the run.** `sys_automation_run.status` gains
  `refused` and a new `refusal_message` column carries the rendered text; the
  refusal is never folded into `error`, which would tell every reader the run
  broke. `RunRecord` gains `refusalMessage` and `TerminalRunStatus` gains
  `refused`, so history rows are written, aged and read back like any other
  terminal.
- **A refused run is never resumed.** It writes no continuation, so `resume`
  answers `RUN_NOT_FOUND`.

Untouched on purpose: a paused run still returns `silent` with no
`successMessage`, and a plain `end` — or one declaring `outcome: 'completed'` —
completes exactly as before.

An `end` declaring `outcome: 'refused'` **inside a structured region** (a `loop`
body, a `try`/`catch` region) is refused loudly rather than honoured: a refusal
terminates the run and a region body cannot end one. Previously such a node was
a silent no-op like every other `end` in a region, so nothing that ever worked
stops working — put the refusing `end` on the top-level graph and route the
region's exit to it.
