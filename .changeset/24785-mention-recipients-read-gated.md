---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an @mention notification reaches only mentioned users who can read the comment's record

Clause-②: no (narrows who a notification reaches; no key, route or payload shape is added)

- **Recipients are judged by read access to the record.** The `sys_comment` mention writer used to emit one `collab.mention` notification per entry in `mentions`, as written. It now resolves each entry to a user and asks, in that user's own envelope, whether they can read the record named by the comment's `thread_id`. The envelope comes from the resolver every request uses (`resolveUserAuthzGrants`). The user's organization claim is vetted under the tenancy posture in force (`vetOrganizationClaim`). The read goes through the evaluator every parent-derived read gate uses (`resolveReadableParentIds`). So the tenant wall, sharing, RLS and object permissions decide, as they do when that user opens the deep link. A user who cannot read the record gets no notification, and a `warn` line records their id and the reason (never the comment text).
- **Email entries resolve to a user first.** An email-shaped mention is looked up to its user and then checked like an id. An email that matches no user notifies nobody. Before, the email was passed on to messaging, which resolved it without regard to organization. Entries that expand an audience (`role:`, `team:`, `owner_of:`) name no single person and are no longer mentions.
- **Fail closed.** A comment whose thread names no record, a record that cannot be found, and a grant resolution that fails all withhold the notification. `installAuditWriters` takes the gate as `admitMentionRecipients`, and `AuditPlugin` wires it. A host that calls `installAuditWriters` without one emits no mention notifications and is told so once at `warn`.
