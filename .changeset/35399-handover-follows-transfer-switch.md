---
'@objectstack/core': minor
'@objectstack/client': minor
'@objectstack/rest': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

fix(core, console): a banned user's hand-over follows each object's Change Owner switch, and the ban dialog says why a record stays

Clause-②: no
Metadata-protocol: semantic

An object's Change Owner switch (`userActions.transfer`) now also decides whether the offboarding hand-over (`POST /api/v1/security/users/USER_ID/assigned-work/transfer`) moves the object's `owner_id`, and how the count (`GET /api/v1/security/users/USER_ID/assigned-work`) reports it. The hand-over reads the same resolution the Change Owner action refuses by (`resolveUserActionTransfer`), so the two never disagree:

- An object that turns the switch off keeps its records' owners where they are. Before, the hand-over moved them.
- A `controlled_by_parent` detail that leaves the switch out keeps its owner (the default is off there), as before. A detail that sets `userActions.transfer: true` now has its owner handed over like any other object. Before, every detail's owner was skipped.
- The object's own user fields (an approver, an assignee) are handed over whatever the switch says.

A kept owner is still counted. Before, a detail's owner was left out of the count; now its row answers `transferable: false` with `reason: 'transfer_off'`. A multi-valued user field answers `reason: 'multi_valued'`. `reason` is a new optional member of each `objects[]` row in `security.assignedWork.count`'s answer (`UserAssignedWorkSummary` in `@objectstack/client`, `UserAssignedWorkHoldReason` in `@objectstack/core`). It is present exactly when `transferable` is false.

The ban dialog words each kept row by its reason. A kept owner reads "Not handed over: this object keeps the owner of each record (Change Owner is off for it)." (zh: 不会交接：该对象的记录负责人保持不变（该对象已关闭“更改负责人”）。). A multi-valued row keeps its own sentence ("Lists several people, so it cannot be handed over here."), and a kept owner never shows it. The new `console.assignedWork.ownerKept` key is in all eleven UI locales.

To keep the old hand-over of an object you switched off, set `userActions.transfer` back on for it. Before this change the switch gated only the Change Owner action; it now gates that action and the hand-over, and nothing else: a plain `owner_id` write (an import, a hook, a `PATCH`) still needs only the transfer grant.
