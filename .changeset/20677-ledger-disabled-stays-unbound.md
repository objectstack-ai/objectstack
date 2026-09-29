---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow switched off in the activation ledger stays unbound after a restart, and a trigger-fired refusal no longer logs an ERROR claiming a run-history row (#20677)

Clause-②: no

**What was wrong.** A packaged flow switched off through the ADR-0126 activation
ledger (`POST /api/v1/automation/:name/toggle` with `enabled: false`) came back
`bound: true` after every cold restart. Its runs were still refused, so the switch
itself held, but its trigger was armed again. At boot the automation service pulls
the flows and applies the ledger, which leaves a switched-off flow unbound. The
trigger plugins register later, at `kernel:ready`, and registering a trigger armed
every matching flow without asking whether it may run. So `GET
/api/v1/automation/_status` reported the flow `enabled: false, bound: true`. Each
matching event also logged `ERROR Trigger-fired run of flow '…' failed`, saying the
failure "is recorded in the flow's run history", while no run row was written.

**What changed.**

- The engine checks whether a flow may run in one place: at the step that arms a
  trigger. Every arming path goes through it: flow registration (boot pull,
  publish, hot reload), trigger registration, and the enable toggle. A flow that
  either disable dimension switches off (the activation ledger, or an `obsolete` /
  `invalid` status) is never armed, whenever its trigger registers.
- Re-enabling a flow arms it on its trigger as before. Re-enabling the ledger bit
  of a flow whose `status` is still `obsolete` or `invalid` no longer arms it, since
  every run it fired would be refused.
- A trigger-fired run refused because the flow is disabled (for example, an event
  already in flight when the flow was switched off) is logged at `info`, saying
  nothing ran and no run-history row records it. It is no longer an `ERROR`.
- The `ERROR` line for any other trigger-fired failure says the failure is
  recorded in the run history only for a run that dispatched and failed. A run
  refused before it dispatched gets the same line without that claim.

**What is not affected.** The runtime refusal (`FLOW_DISABLED`) and its message are
unchanged. The enabled flows beside a disabled one arm exactly as before. No export,
option, route or response shape changes.
