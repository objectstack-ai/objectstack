---
'@objectstack/spec': minor
---

feat(spec): `enable.approvalsVisibleToReaders`, the per-object opt-in for read-only approval visibility to a record's readers

Clause-②: yes (widening)

- **The key.** `ObjectCapabilities` (an object's `enable` block) gains `approvalsVisibleToReaders`, a boolean that defaults to `false`. An object that declares nothing is unchanged.
- **What `true` grants.** A caller who can read a record of the object sees that record's approval requests and their full action history, read-only. "Can read" is the object's own CRUD, sharing and RLS, asked as the caller. No new permission is granted. This holds on the approvals API and on the generic data API alike (`sys_approval_request`, `sys_approval_action` and `sys_approval_approver`), on a read that names the record. A list that names no record, such as the inbox, is not widened. No approval action is offered: approve, reject, reassign, recall and comment keep authorizing as before.
- **What becomes visible.** The request row, including its snapshot of the record at submission, and each action's actor, decision, time, comment text and attachments. Turn it on only for objects whose approval commentary the record's readers are meant to see.
- **Studio.** The object form's Capabilities section lists the new toggle.
- **Nothing to migrate.** To opt an object in, write `enable: { approvalsVisibleToReaders: true }` on it.
