---
'@object-ui/permissions': patch
'@object-ui/console': patch
---

fix(console): `/auth/me/permissions` is asked in the same wave as `organization/list` when the session already names the active organization

Clause-②: yes (widening)
Metadata-protocol: none

Opening `/home` or an app used to wait a whole round trip before the permissions request left: the Console's one permissions source renders under the route's organization gate (`organization/list`) and the metadata shell (the adapter's `discovery`), and both of those leave when the session answer lands. The server answers `/auth/me/permissions` for the session's active organization, which the `get-session` answer already names.

- **`@object-ui/permissions`**: `startMePermissionsRequest({ endpoint, fetcher, key })` asks now and holds the request; `MePermissionsProvider` takes it as its first attempt when its new `requestKey` prop matches (once; any other question asks as before and drops it). `releaseMePermissionsRequest(endpoint, key)` drops a request nobody took. A provider without `requestKey` behaves exactly as before.
- **Console**: the `/home` + `/apps` route asks as soon as the session names the organization, and its permissions provider takes that request, so the number of requests does not change. The organization gate, the `/me/apps` read and every page still wait for the chosen organization. A session that names no organization keeps the old order.
