---
'@objectstack/platform-objects': patch
'@objectstack/metadata-core': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-approvals': patch
'@objectstack/service-messaging': patch
'@objectstack/objectql': patch
---

fix: Setup field help is written for administrators, and the two access-review fields nothing uses yet are hidden from the Setup forms

Clause-②: no
Metadata-protocol: none

A Setup pass met field help written for the platform's developers: "Foreign key to sys_user.id", "NULL only on a grant written before the column existed", "via isGrantActive", "(P3 digest middleware)", "Owned by objectql (better-auth is oblivious to this column)", "LifecycleService (Reaper / Rotator / Archiver)" and ADR numbers. Each now says what the field means and what to do with it, in every shipped locale (`en` regenerated from the source; `zh-CN`, `ja-JP` and `es-ES` translated):

- the user, OAuth application, session and refresh-token fields of the permission-set and position assignments and of the OAuth token, consent and client-resource objects, and the package-version field of stored metadata;
- the permission set picked on an assignment;
- the start time of an approval delegation;
- the digest cadence and quiet hours of a notification preference, which now say how each value behaves;
- the AI Access and Locale fields of a user;
- the Data Lifecycle settings page and its retention overrides.

`Last Certified At` and `Certified By` on `sys_user_permission_set` and `sys_user_position` are reserved for a future access-review feature and nothing writes or reads them. They are now `hidden: true`, so the Setup forms and detail pages no longer show them. The columns and any stored values stay.
