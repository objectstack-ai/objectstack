---
"@objectstack/objectql": patch
---

fix(objectql): a failed `sys_organization` tenant scan no longer decides a retention window (#12853)

`LifecycleService.loadGovernance()` filled `snapshot.tenantOverrides` — the
ADR-0057 §3.2 per-tenant retention/expiry window set — behind a bare `catch {}`
whose comment named ONE benign cause ("No sys_organization (single-tenant
kernel)") while the `catch` swallowed every cause. On a connection drop, a
timeout, a permission refusal or a driver fault the map came back EMPTY, and an
empty map is not a neutral value: `reap()` and `archiveObject()` read it as
"this deployment has tuned no tenant" and fall every tenant back to the global
window. That window is wrong in both directions, and the expensive direction is
a tenant configured to retain LONGER having its rows expired early. Nothing
reported it: `GovernanceSnapshot` carries no field saying the tenant pass did not
complete, and the catch logged nothing — so the platform deleted on knowingly
incomplete evidence, without knowing the evidence was incomplete.

The scan now discriminates by error TYPE through the shared
`isMissingTableError` predicate. An unprovisioned `sys_organization` really does
mean "no tenant overrides", so a single-tenant kernel is unchanged. Every other
cause aborts the sweep **before any policy is applied** — for a deletion action,
"do not act on incomplete evidence" is the correct failure direction, and a log
cannot bring back a reaped row. The rows a deferred sweep leaves are still there
for the next one.

Operational posture change, deliberate and worth stating: a transient
`sys_organization` outage now costs a sweep. The abort is REPORTED, not thrown —
one `report.errors` entry per declared object plus a `warn` — because `sweep()`'s
declared contract is that it never throws and the scheduler enters it as
`void this.sweep()`, where a rejection would be unhandled. That is the same
objection #8906 recorded when it declined to rethrow from `checkGovernance` one
method below.

Bump argued, not defaulted: `patch`. No exported signature, type, option or
report field moves — the failure surfaces through `LifecycleSweepReport.errors`,
which already exists for exactly this. The tension is honest and does not change
the answer: what a deployment observes on a failure path DOES change (a sweep
that used to complete silently now aborts and says so), but that is the
correction of a defect, not a new capability, and the sibling repairs in this
family (#8896, #8906, #9817) all shipped as `patch`.
