---
'@objectstack/verify': patch
---

docs(verify): the README says how a local stack arms scheduled flows

Clause-②: no
Metadata-protocol: none

The README's `flows.run(…, { system: true })` passage now says that this call works with scheduled work off. It also says that a local stack only arms time-triggered flows on their own cadence when `OS_AUTOMATION_SCHEDULED_WORK_ENABLED=true` is set; package-authored scheduled work is off by default in every posture.

What to do: nothing. Only the packaged README changes.
