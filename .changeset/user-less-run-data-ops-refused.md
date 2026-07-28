---
"@objectstack/service-automation": major
"@objectstack/cli": major
"@objectstack/plugin-approvals": patch
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
"@objectstack/spec": patch
---

feat(automation)!: a flow run with no trigger user may no longer touch data (#3760)

An effective `runAs:'user'` run that resolves **no trigger user** used to execute
its data nodes **UNSCOPED** — it presented no principal, and the data security
middleware skips when there is no principal, so the run read and wrote every row.
`runAs:'user'` is an access-*narrowing* declaration; failing to resolve it must
never resolve to a grant (ADR-0049). It now **refuses** the operation
(`UnscopedRunDataAccessError`), naming `runAs:'system'` as the fix.

**This was never really about schedules.** The docs, the spec, the runtime
warning and the lint all described a schedule-shaped problem, and the lint only
ever matched that shape. But the runtime predicate is "no user", and the
commonest way to have no user is a **record-change flow fired by a write that
carried none**: `isSystem` does *not* suppress trigger dispatch — only
`skipTriggers` does, and exactly three first-party paths set it — so every
plugin/service system write, the approvals status mirror, and a `runAs:'system'`
flow's own data node dispatched record-change flows with `userId: undefined`.
Ordinary users reach those writes routinely (submitting for approval mirrors a
status onto the target record), so the fail-open was reachable by unprivileged
input and was the common case, not the rare one.

Deliberately **not** implemented as "inherit the triggering write's posture and
run as `isSystem`". That reads like a relabel but is a privilege escalation: the
security middleware's `isSystem` short-circuit fires *before* its
package-managed-row, system-row, audience-anchor and delegated-admin gates, all
of which a principal-less context still has to clear. Such a run cannot write
`sys_user_position` today; as `isSystem` it could. "Unscoped" was never
equivalent to "system".

**Breaking — how to migrate.** A flow that reacts to system writes and needs to
act beyond one user's grants declares `runAs: 'system'`, making the elevation
explicit and audit-attributable. Otherwise ensure the trigger supplies a user.
Flows that touch no data are unaffected (`runAs` is moot), and the failure is
isolated: the trigger already swallows flow errors, so the originating write
still succeeds. The engine warns at run *setup*, before any node executes.

**#3712's user-less provenance path is subsumed, not broken.** That fix let a
run with no trigger user write its own approval-locked record by carrying a
provenance-only ObjectQL context (the run id, nothing else). Such a run can no
longer perform a data operation at all — presenting no principal is exactly what
made the write unscoped — so it is refused before the lock is consulted. The
capability survives via the explicit route: a schedule that must write records
declares `runAs:'system'`, which the lock hook exempts on its own `isSystem`
branch. The `flowRunId` exemption itself stays live and load-bearing for what
#3703 built it for — a `runAs:'user'` run that *does* have a user — where the
exemption is still provenance rather than privilege.

Also in this change:

- **`flow-schedule-runas-unscoped` → `flow-runas-unscoped`, and it now fails the
  build.** It read as a gate and behaved as a comment — `os compile` documented
  that the flow lint "NEVER fails the build" — which is close to no net at all
  for the audience it protects, very often an AI generating flows in bulk. It now
  also covers the other provably user-less triggers (`time_relative`, `api`), per
  ADR-0073 D5. It still cannot cover `record_change`, which is undecidable at
  authoring time — that is exactly why the runtime refusal exists.
- **Three seed writes stopped firing automation.** The seed loader's pass-2
  deferred-reference back-fill and both of `AppPlugin`'s basic-insert fallbacks
  inlined a bare `{ isSystem: true }` instead of the shared seed options, so they
  seeded with record-change automation live — the self-trigger vector
  `skipTriggers` exists to prevent, on the writes that skipped it.
- **ADR-0073 amended.** Its severity rationale ("an unprivileged user cannot
  trigger a schedule, so there is no untrusted-input path") is falsified, and its
  rejection of fail-closed ("breaks legitimate scheduled CRUD — 2/3 example flows
  relied on the default") expired when those flows were fixed to declare
  `runAs:'system'`. Refusal is an interim posture, forward-compatible with the
  ADR's `automation` principal: when that lands, the refusal point becomes the
  place that resolves it.
