---
'@object-ui/console': patch
---

fix(console): `/auth/me/permissions` is asked in the same wave as `organization/list` when the session already names the active organization

Clause-②: no
Metadata-protocol: none

Opening `/home` or an app used to wait for the whole `organization/list` round trip before the permissions request left, because the Console's one permissions source sat under the route's organization gate. The server answers that endpoint for the session's active organization, which the `get-session` answer already carries. When it does, the Console now asks for permissions at once, beside `organization/list`, and keeps the organization gate below it: the launcher's `/me/apps` read and every page still wait for the chosen organization, and no request is added. A session that names no organization keeps the old order, so the organization pipeline can still activate one or send the user to `/organizations` before anything asks for permissions.
