---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a trigger binding does not dispatch a slot whose package is disabled (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answer is a trigger-fired run under a reversible package state: no stored row, slot key, run key, trigger binding or dispatch key changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment where two packages each ship a flow of the same name and one of them is disabled at runtime: that package's flow no longer runs on its trigger (record-change, schedule, time-relative, or an api inbound hook's queued post). Before this release it kept running.

When two packages each ship a flow of the same name, the engine holds one slot per package and arms each slot's trigger. Until now a slot whose package was disabled at runtime kept running on its trigger, because the run a trigger fires executed the armed slot without asking whether its package is still served.

Now the engine asks when the trigger fires. While the slot's package is disabled, the run is skipped: nothing runs, no other package's flow of the name runs in its place, and no run-history row is written. The skip is logged once at `info` per slot while the package stays disabled. When the package is enabled again, the slot runs on its trigger again, with no re-arm.

An event that fires while the package is disabled is dropped, not replayed when the package is enabled again: a one-shot schedule or time-relative fire that falls inside the disable is lost, as it is for a switched-off flow.

Nothing durable moves: slot keys, run keys, the trigger bindings and the dispatch holder stay judged over every holder, so there is nothing to migrate. A flow name only one package ships answers as before.
