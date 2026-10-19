---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an approval's status write-back runs its automation as the person who acted, in the record's organisation

Clause-②: no

- **What changes.** The write that mirrors a request's status onto the record's `approvalStatusField` (submit, approve, reject, recall, send back, the action link) now names the organisation of the record it writes, and no longer carries an empty set of positions and permission sets. A `runAs: 'user'` hook on that object, and a `runAs: 'user'` record-change flow fired by that write, now run with the acting person's own request envelope in the record's organisation: their positions, their permission sets and their organisation's members, resolved exactly as their own request in that organisation resolves them.
- **Before.** Such a hook ran on the member baseline and saw only the acting person in `sys_user`. Such a flow resolved the person's grants with no organisation, so it saw only the person as a peer and did not run with what the record's organisation grants them.
- **Every acting person, one organisation.** An approver drawn from another organisation's directory also acts in the record's organisation. The organisation is read from the record when the status is written, so a record moved to another organisation while its approval was pending is written, and cascades, in its new organisation.
- **Unchanged.** The write stays elevated (`isSystem`), so it still lands on a locked record and on a read-only status field. A status written by a sweep with no person behind it (the dead-run release) stays user-less, so a `runAs: 'user'` automation it fires is still refused. `ctx.session.organizationId` in a hook on the write now carries the organisation, and `ctx.session.positions` is absent instead of an empty list.

A patch: no export, type, accepted value or stored column changes.
