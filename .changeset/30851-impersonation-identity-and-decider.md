---
'@objectstack/spec': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-approvals': patch
'@objectstack/service-automation': patch
---

fix(audit): name the impersonating administrator on identity writes and on an approval decided while impersonating

Clause-②: yes (widening)
Metadata-protocol: none

Two writes an administrator makes while impersonating a user still read as the user's own in the audit ledger. Both now carry the same attribution-only `impersonatedBy` a record write from that session already carries, recorded as `sys_audit_log.metadata.impersonated_by`. `user_id`, `actor` and every permission stay the impersonated user's.

- **Identity-table writes (`@objectstack/plugin-auth`).** A write better-auth makes on the user's behalf (renaming the profile, changing an email, a membership change, an admin route such as set-user-manager) runs as the system and is credited to the user through `attributedUserId`. On an impersonation session it now also names the administrator, read from the session row's `impersonatedBy`, never from the request body. `authSystemWriteContext()` builds it, and the adapter's `withSystemContext` writes now use that same builder. `resolveAttributedActor()` (new) answers the user and the administrator together; `runAttributedToUser()` also accepts the admitted actor object, whose new optional `impersonatedBy` the platform-admin gate fills from the session.
- **The approval decider's segment (`@objectstack/spec`, `@objectstack/plugin-approvals`, `@objectstack/service-automation`).** `ResumeSignal.impersonatedBy` (new, optional) names the administrator when the decider decided from an impersonation session. It is honoured only beside `resumedBy`, on a signal carrying `RESUME_AUTHORITY_SERVICE`, so an HTTP body cannot set it. The approvals decision door fills it from the decision request's context, and a stranded decision's journal keeps it for the replay. The nodes after the decision now carry exactly the decision's administrator, and none when the decider acted in their own name. Before this, a trigger user deciding their own run kept the stamp of the write that started it, and a decider deciding while impersonated carried none.

No schema column and no migration.
