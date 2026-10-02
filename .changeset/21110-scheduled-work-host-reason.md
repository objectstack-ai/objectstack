---
'@objectstack/types': minor
'@objectstack/service-automation': minor
'@objectstack/trigger-schedule': minor
---

feat(types,automation): a host's per-kernel scheduled-work OFF reports the host's own reason (#21110)

Clause-②: yes (widening)

`ScheduledWorkPolicy` (`@objectstack/types`) gains an optional
`hostDisabledReason`: the host's own sentence for why scheduled work is off on
this kernel, such as a plan that does not include scheduled flows. A new
export, `scheduledWorkDisabledReason(policy)`, gives the one answer for why
scheduled work is not armed under a policy. It returns the host's reason when
the policy carries one, and `SCHEDULED_WORK_DISABLED_REASON` otherwise.

Every refusal site now reports that answer, read from the same policy reading
that refused:

- the automation engine's bind log;
- the reason it records for `getTriggerBindingAudit()` and for the
  `FlowRuntimeState.reason` that `GET /automation/_status` serves;
- the refusal of `ScheduleTrigger` and `TimeRelativeTrigger` when a host drives
  them directly.

Before this, a kernel that a host turned off through `scheduledWorkPolicy`
was reported with the deployment sentence. That sentence tells the reader to
set `OS_AUTOMATION_SCHEDULED_WORK_ENABLED=true`, even on a process where the
variable is already set, and to a tenant who cannot set it.

Nothing changes without the new field. A policy with no `hostDisabledReason`,
and the zero-argument deployment resolver `resolveScheduledWorkPolicy()`, which
never sets it, report `SCHEDULED_WORK_DISABLED_REASON` byte for byte. The field
is read only when `enabled` is `false`.

To use it, a host that turns one kernel off for its own reason sets
`hostDisabledReason` on the `enabled: false` policy it already hands to that
kernel's `AutomationServicePlugin`, `ScheduleTriggerPlugin` and
`TimeRelativeTriggerPlugin`. Give the same policy to all three, as before, and
make the reason a whole sentence that names the cause and the remedy. It is
shown verbatim.
