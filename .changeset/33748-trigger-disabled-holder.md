---
'@objectstack/service-automation': patch
---

fix(service-automation): a trigger binding does not dispatch a slot whose package is disabled

Clause-②: no
Metadata-protocol: none

When two packages each ship a flow of the same name, the engine holds one slot per package and arms each slot's trigger (record-change, schedule, time-relative, api inbound hook). Until now a slot whose package was disabled at runtime kept running on its trigger, because the run a trigger fires executed the armed slot without asking whether its package is still served.

Now the engine asks when the trigger fires. While the slot's package is disabled, the run is skipped: nothing runs, no other package's flow of the name runs in its place, and no run-history row is written. The skip is logged once at `info` per slot while the package stays disabled. When the package is enabled again, the slot runs on its trigger again, with no re-arm.

Nothing durable moves: slot keys, run keys, the trigger bindings and the dispatch holder stay judged over every holder, so there is nothing to migrate. A flow name only one package ships answers as before.
