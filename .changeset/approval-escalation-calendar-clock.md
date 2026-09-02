---
"@objectstack/spec": patch
---

docs(spec): `ApprovalEscalation.timeoutHours` names its clock — calendar (wall-clock) hours

The `timeoutHours` describe text now states that the hours are calendar
(wall-clock) hours: nights, weekends and holidays count, because the platform
ships no business-hours calendar, so a request opened at 17:00 on a Friday with
`timeoutHours: 4` escalates at 21:00 that same Friday. The sentence is published
contract text — it is what `gen:schema` emits to the JSON schema `description`
and what the reference page carries — so the unit is part of the declaration an
author reads at authoring time rather than prose beside it. No key is added,
renamed or defaulted differently; the approvals service's arithmetic is
unchanged and is now pinned by a wall-clock test (Friday 17:00 + 4 h, a 168-hour
deadline across a weekend, a DST transition).
