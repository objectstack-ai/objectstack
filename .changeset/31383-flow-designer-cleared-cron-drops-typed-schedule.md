---
'@object-ui/app-shell': patch
---

fix(app-shell): clearing a start node's Cron schedule in the flow designer no longer leaves a typed schedule block with no cadence

Clause-②: no
Metadata-protocol: none

Clearing the Cron schedule box on a typed `config.schedule` such as `{ type: 'cron', expression, timezone }` used to store `{ type: 'cron', timezone }`. The engine binds nothing from that block, so a schedule flow silently never ran and a time-relative sweep did not fall back to its daily default the way the field's help says. The published `ScheduleSchema` refuses the same block. An untyped `{ expression, timezone }` had the same fault: clearing it left `{ timezone }`, which binds nothing either. The designer now removes `config.schedule` entirely whenever clearing the cron leaves no cadence, as it already did for an untyped `{ expression }`. Typing a cron over a typed block still keeps its `type` and `timezone`.
