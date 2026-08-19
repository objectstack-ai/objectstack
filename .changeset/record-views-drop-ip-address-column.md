---
"@objectstack/plugin-audit": patch
---

fix(audit): `record_views` list view drops its always-empty `ip_address` column, replaced with `actor` (#9539)

`sys_audit_log`'s `record_views` list view (the "who viewed this record" screen, #8992)
declared an `ip_address` column, but `buildRow` in `read-audit.ts` never stamps that key
on a `read` row — client-fingerprint fields are populated on auth events only. The column
was structurally empty on every row this view can ever show, which on a compliance
surface reads as "we captured the fingerprint and this request had none" rather than
"not captured" — the same 审计面宁窄勿谎 (narrow-not-untruthful) defect class #7675 /
#8147 / #8315 retired from this object's `action` enum, one layer down on a column.

Replaced with `actor`, which the read writer DOES stamp on every row and which attributes
a service principal (`svc:<name>`) that `user_id` structurally cannot hold. Pinned by
`sys-audit-log-record-views-columns.test.ts`, which derives the read writer's actually-
stamped key set from a real engine run rather than a hand-copied list, so the class can't
regrow silently.

Maintainer ruling 2026-08-18 + triage auto-adjudication 2026-08-19 (both Option 1).
Stamping viewer IP (Option 2) was explicitly NOT commissioned in this change.
