---
"@objectstack/runtime": patch
---

fix(runtime): the paused-run screen read is gated to the run's trigger identity, or the `sys_automation_run` grant (#7968)

`GET /api/v1/automation/:name/runs/:runId/screen` answered **any authenticated
caller who knew a run id** with the paused run's `ScreenSpec` — and that spec is
not inert with respect to record data. A screen node's `defaults` and per-field
`defaultValue` are interpolated against the live flow variables at suspend time,
so a flow that prefills from its triggering record persists those values into the
spec this route serves.

Measured on a real screen flow over a `crm_lead` record: a caller with valid
auth, no relationship to the run, and explicitly refused the `sys_automation_run`
read grant received `200` with the lead's company in the screen title, its email
address in the description, and its email, phone and salary band as three field
defaults. Reaching it needed only a session plus a leaked or guessed run id.

The route now requires **the identity that triggered the run**
(`ExecutionLogEntry.trigger.userId`) **OR** read access to `sys_automation_run`
as an operator override. A refused caller gets `403 PERMISSION_DENIED`.

**Why not the object grant on its own** — the mechanism the sibling run-state
reads converged on in #7900: it would refuse the screen to the very person the
flow paused for. The pause exists because the flow is asking *that* caller to
fill a form in, so the grant is the override half here, never the whole question.
Operator tooling that already holds the `sys_automation_run` read grant is
unaffected, and so is the end user — including while the permission subsystem is
unreachable, since only the override half fails closed.

**Unchanged**: which runs exist; `resume`'s own per-run `resumeAuthority` checks
(#3801 / #5561); the `404 No pending screen for run` answer, which still comes
back for an unknown or non-paused run id, for every caller, ahead of the gate; the
`501` a deployment without screen lookup returns; and the `401` anonymous floor.

A deployment with no `plugin-security` (no object-permission system at all, so
`/data/sys_automation_run` is itself ungated) keeps answering as before.
