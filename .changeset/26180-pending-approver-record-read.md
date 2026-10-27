---
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-security': patch
---

fix(plugin-approvals,plugin-sharing): the approver a pending step waits on can read the record the request is about

Clause-②: no
Metadata-protocol: none

An approver was asked to decide on a record they could not open. Unless the app happened to grant them read of that exact row, the request page showed only the snapshot and the record card read "unable to open this record", so a contract was approved without its document being read.

- **Who reads.** While an approval request is pending, each person on its current step's slate (a slot naming their user id, or the email their own account carries) and the override holder (the administrator who may decide any pending request of their organization) may READ the one record the request is about. A slot left as a `position:` or `team:` literal names no person and grants no read.
- **How far.** Read only: the write gates never read this grant, so the approver still cannot edit or delete the record. Only the record itself, as a reader of it reads it: attachments follow the record read, as they do for any reader. Only while the step is pending: a decision that resolves the step, or advances the request to its next step, ends the grant at the next read. Never across organizations, the platform administrator's override included. An on-behalf-of (agent) principal gets no approval grant.
- **Where it is decided.** `@objectstack/plugin-approvals` derives the records from the slate it already resolves (`ApprovalService.pendingApproverReadGrants`, one indexed read of the pending-approver index per request context, plus one request read per object, memoized per request and retired by any write). `@objectstack/plugin-sharing` ORs those record ids into its read filter beside the caller's record shares, so every read door that composes the sharing filter serves them; it grants nothing when the approvals service is absent or its read fails.
- **Explain.** `@objectstack/plugin-security`'s access explanation names the grant on the sharing layer as a read share "via approval request N".

The grant is the row-level reach of a read share; the approver still needs read on the object itself. Nothing is declared: no metadata key, no app setting.

What to do: nothing. An app that wrote sharing rules mirroring its approval routing only so approvers could open the record may drop them.
