---
'@objectstack/service-automation': minor
---

**Automation runs now record what triggered them — and keep it across a restart (#7533).**

Two gaps in run attribution, both measured by QA run #7516 (`trigger-type-matrix`):

- **`trigger.recordId` is populated on `record_change` runs.** The field was declared in
  `ExecutionLogSchema` and written by nothing, so the platform's most common trigger kind
  produced runs that could not be correlated to the record that caused them — neither
  "which record provoked this run?" nor "which runs did this record provoke?" was
  answerable from the run log. The trigger block is now built at a single chokepoint
  (`buildRunTrigger`) instead of being re-spelled at each of the ten places a run is
  logged, which is how `recordId` came to be omitted from all ten.
- **The durable `sys_automation_run` row carries the trigger block.** The in-memory run
  recorded its runtime kind; the persistence mapping dropped it, so after a process
  restart a scheduled run, a webhook intake and a record change were indistinguishable
  rows — the durable copy of the history was strictly less informative than the volatile
  one. `sys_automation_run` gains `trigger_type`, `trigger_object` and `trigger_record_id`
  as **columns** (not a JSON blob: both questions above are queries, not readings of a
  single row), indexed on `(trigger_object, trigger_record_id)`. Written on terminal
  history rows and on live paused rows alike.

Rows written before this change carry no trigger columns; they keep rehydrating exactly as
they did, with an empty trigger type. Absent means "not recorded", never "no trigger".
