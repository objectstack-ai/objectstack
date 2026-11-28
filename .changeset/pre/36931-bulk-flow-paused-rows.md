---
'@object-ui/types': patch
'@object-ui/plugin-grid': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a per-record bulk flow action counts a record whose run paused at a screen as waiting for input, and every paused record's screen opens in turn

Clause-②: yes
Metadata-protocol: none

The published `@object-ui/types` adds one optional member, `ActionResult.paused`. Nothing existing is narrowed.

A list view's selection bar can run a `type: 'flow'` action once per selected record. A run that reaches a `screen` node pauses and waits for input. Before this change the bulk result counted such a record as succeeded ("Succeeded 3 / 3"), and the console held one paused run at a time: each paused record replaced the previous one, so only the last record's screen opened and the other records' runs waited at screens nobody could reach.

- The result now counts paused records apart: "Succeeded 1 / 3 · Waiting for input 2". Each waiting record is listed by name, under a line saying its screen opens next. A waiting record has no Retry and is not written to the error CSV: a re-run would start a second run. When a failed record is retried and its run pauses, it moves to the waiting list.
- The console now queues paused runs. Its flow runner shows the first paused record's screen, and closing or completing it shows the next one, until none is left. This holds for the console's list runtime and for a list on a record page.
- `ActionResult.paused` (`{ runId }`) is set by the console's flow launch on a run that paused at a screen, beside `success: true` and `handedOff: true`. A caller that counts outcomes reads it as waiting, never as done.
