---
'@objectstack/runtime': minor
'@objectstack/types': minor
'@objectstack/trigger-schedule': patch
---

feat(runtime): package jobs honour the host's per-kernel `scheduledWorkPolicy`

Clause-②: yes — an optional `scheduledWorkPolicy` member on `AppPlugin`'s options and on `AppArtifactJobSchedulingOptions` (both exported from the `@objectstack/runtime` entry), and `ScheduledWorkPolicySource` / `readScheduledWorkPolicy` newly exported by `@objectstack/types`, widen published surfaces; nothing narrows.
Metadata-protocol: none

A host that runs many kernels in one process can turn package-authored scheduled work off for one kernel by handing it a `scheduledWorkPolicy`. The automation engine and both schedule triggers have taken it since the per-kernel policy landed, but a package's `jobs` did not: `scheduleAppArtifactJobs` read only the deployment switch `OS_AUTOMATION_SCHEDULED_WORK_ENABLED`, so on a kernel whose host turned scheduled work off, the `schedule` flows stayed unarmed while the same package's jobs kept running.

- `AppPlugin` takes an optional `scheduledWorkPolicy` in its third constructor argument and hands it to the jobs binder on `kernel:ready`.
- `AppArtifactJobSchedulingOptions` takes the same optional `scheduledWorkPolicy`, a value or a resolver. When it is present, `scheduleAppArtifactJobs` reads it once per call in place of both deployment reads: `enabled` gates the call, and `requiresActingOrganization` / `runOwnership` decide whether each job must declare its `organization`.
- When that policy is off, nothing is scheduled, the result is `withheld: 'scheduled-work-disabled'`, the jobs the app scheduled before are cancelled, and the info line carries the host's own `hostDisabledReason` when it gave one, instead of the sentence that tells the reader to set the environment variable.
- A resolver that throws fails closed: nothing is scheduled, the app's earlier jobs are cancelled, the result is `withheld: 'scheduled-work-policy-unreadable'`, and the reason is logged at `error`.
- When no policy is handed, the deployment switch decides, exactly as before.

Give the kernel's engine, its schedule triggers and its `AppPlugin` the same policy.

`ScheduledWorkPolicySource` and `readScheduledWorkPolicy` now live in `@objectstack/types` beside `ScheduledWorkPolicy`, so every binder spells the source type once. `@objectstack/trigger-schedule` re-exports `ScheduledWorkPolicySource` under the same name, so existing imports keep working.
