---
'@objectstack/platform-objects': minor
'@objectstack/plugin-audit': minor
'@objectstack/plugin-approvals': minor
---

fix(platform-objects,plugin-audit,plugin-approvals)!: mail bodies are read only with `manage_platform_settings`, and the audit mirrors never copy them in clear

Clause-②: yes (narrowing). A principal without `manage_platform_settings` (an organization administrator, a member) loses read access to the body of every mail-log row.

<!-- adr-0087: not-required (no-migration-prescription) A read-access narrowing on two existing fields (sys_email.body_text and body_html, and the same columns of sys_identity_email), plus a masked value in the audit copies and one object's free-text search set. No spec key, enum value, export, option, config field, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. The three packages publish (not unpublished); no ADR-0087 id covers this behaviour and this diff adds none (not registered / already-registered); and the change is a behaviour change, not only an interface or type change (not runtime-interface-only / type-surface-only). -->

**BREAKING** (a read narrowing), shipped as `minor` under the launch-window convention for breaking changes.

An 18.0 install wrote its identity mail (password reset, account invitation, verification, magic link, email-change notice) into `sys_email`, stamped with the organization. Those bodies carry reset and sign-in links. `sys_email` had no read gate of its own, so an organization administrator could read them through the data API, global search, and the `sys_activity` / `sys_audit_log` mirrors. New identity mail goes to `sys_identity_email`, but its mirror rows still held the body in clear.

- **Before:** any reader of `sys_email` rows was served `body_text` and `body_html`, could filter and search on them, and found them in the activity and audit copies of the row. The audit writers copied both logs' bodies verbatim.
- **Now:** `body_text` and `body_html` on `sys_email` and `sys_identity_email` declare `requiredPermissions: ['manage_platform_settings']`. A reader without the capability still gets the row: envelope, subject, delivery state and linkage. The body keys are left out. A filter on a body is refused (403). Global search does not match on a body. The activity and audit mirrors serve the reader no body. Their unpinned value-column queries are refused to such a reader, as for any reader withheld a field. The audit writers store `••••••••` for a non-empty body in every copy of a mail-log row (create, update and delete snapshots, and the activity row), as they do for a credential field. `sys_approval_request` free-text search no longer scans `payload_json`, so a reader withheld any field keeps working list and global search instead of a 403. A structured filter on the snapshot is unchanged.
- **Unchanged:** the platform administrator reads every body. The mail pipeline (send, queue worker, outbox sweep, reclaim) reads as the system and is not narrowed. Rows and mirror copies written before this release keep what they stored; the mirrors still serve those copies only to a reader served the body.
- **Why the whole column:** no column tells an 18.0 identity row apart from tenant mail. A magic link carries no `related_object`, and the log has no template column. So the gate covers every row's body, the organization's own mail included.

Remedy: a user who must read mail bodies (for example, to debug a notification template) needs a permission set that grants `manage_platform_settings`. An organization administrator still sees that each message was sent, to whom and with what result.
