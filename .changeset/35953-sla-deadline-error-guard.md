---
'@objectstack/plugin-approvals': patch
---

fix(approvals): a working-time SLA deadline whose calendar read errors no longer fails the request open or the whole list

Clause-②: no
Metadata-protocol: none

When an approval step's escalation counts `working_time` and the working calendar read itself fails (an error that is not a calendar refusal, such as a driver error reading `sys_work_calendar`), opening the request threw after the `sys_approval_request` row was written and its approvers were told, so the approval node failed its flow run. The same error failed every list read and single read that included the row, and so every decision that loads it.

That row is now served with no deadline and the error is logged as a warning; the open returns the request, the run suspends as usual, and the other rows of a list keep their deadlines. A calendar refusal is still served as `sla_due_refusal`, the deadline never falls back to wall-clock hours, and the escalation sweep still skips the row and asks the calendar again on its next pass. The served request shape is unchanged.
