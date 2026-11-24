---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The platform catalog (`objectstack-project/references/platform-catalog.md`) now lists working calendars as shipped. `sys_work_calendar` and `sys_work_calendar_exception` have rows beside `sys_exchange_rate`: each organization keeps its calendars and holidays in Setup, and an approval's `escalation.clock: 'working_time'` reads them. An app no longer declares its own calendar or holiday object. The Planned section keeps only what is still missing: no formula reads a calendar yet.
