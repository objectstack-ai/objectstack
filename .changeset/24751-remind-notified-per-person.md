---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a reminder's `notified` counts each approver address once, not once per slate slot

Clause-②: no

`POST /api/v1/approvals/requests/:id/remind` (`ApprovalService.remind()`) answers `notified` as the number of reminders it handed to messaging: one per distinct approver address on the pending slate. A `per_group` slate lists a person once per group they resolved into, and `pending_approvers` keeps every one of those slots until the first vote, so a person placed in two groups was counted twice while messaging delivered them one reminder. They are now reminded once and counted once, the rule the opening `approval.requested` notice already applies.

A user id and the same account's email are still two addresses: the person holds two slots and receives two reminders, exactly as at the opening. Unchanged: who is reminded, each reminder's topic, payload, deep link and dedup key, the throttle, the submitter check, the `remind` audit row, and `position:*`-style literals, which still notify no one and add nothing to the count.
