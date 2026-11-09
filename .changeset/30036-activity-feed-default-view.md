---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): the activity list opens newest first, without the platform's own rows, under a plain name and description

Clause-②: no
Metadata-protocol: none

- **`sys_activity` declares two list views.** `recent` comes first, so it is the list Home's "view all activity" and the bell's Activity tab open (both name no view): newest first, and only rows a person wrote (`actor_id` set) about something other than the platform's own objects: the metadata store, the data-migration ledger, and every identity object `@objectstack/platform-objects/identity` declares (users, members, organizations, sessions, keys, SCIM): every sign-in stamps the last-login columns on `sys_user` under the signing-in person's own name, the signing key in `sys_jwks` is minted under the first sign-in's session, and adding a person writes `sys_user` and `sys_member` rows that person can read. Sign-in stamps, migrations, seeds and metadata history no longer sit between the business rows; an administrator's edits to users are in `all`. `all` lists every row the reader may read, platform rows included, newest first. Nothing is removed from storage and nothing changes in what is written; every excluded row still has its `sys_audit_log` entry.
- **Label and description.** The object reads `Activity Feed` (zh-CN `动态`) instead of `Activity`, which collided with an app's own activity object (a CRM's calls and meetings), and its description says what the page is instead of `Recent activity stream entries (lightweight, denormalized)`.
