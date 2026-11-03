---
'@object-ui/plugin-list': patch
'@object-ui/permissions': patch
---

fix(plugin-list): the list toolbar offers the "In a queue" toggle only when the organization has at least one queue

Clause-②: yes (widening)
Metadata-protocol: none

The "In a queue" toggle showed on every list of an owned object, because the platform adds the `queue` column to every such object. In an organization with no queue it could only ever return an empty list. It now appears when both of these hold:

- **The object carries the platform's `queue` column**, as before.
- **The session says the organization has a queue.** `GET /auth/me/permissions` answers `hasAnyQueue` (true when the organization has a declared queue or a `sys_queue` row). The console already reads that answer once per session, so opening a list sends no new request and reads no queue list.

When the answer is unknown (no permission provider is mounted, the role-based `PermissionProvider` is used, or the session is anonymous), the toggle stays hidden. Turning the toggle on filters exactly as before, and the server's queue behaviour (claim, release, the read rule) does not change.

`@object-ui/permissions`: `PermissionContextValue` gains one optional member, `hasAnyQueue?: boolean`. `MePermissionsProvider` sets it from the authenticated answer. It is `undefined` with no answer.
