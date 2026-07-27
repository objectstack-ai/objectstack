---
"@objectstack/client": minor
"@objectstack/spec": minor
---

feat(client,spec)!: delete the 21 dead SDK methods and the four ghost route
tables that underwrote them (#3612, #3587 finding)

Five client surface families built URLs that exist on NO server surface —
not the dispatcher, not `@objectstack/rest`, not the autonomous service
mounts — so every call was a guaranteed 404:

- `permissions` (check, getObjectPermissions, getEffectivePermissions)
- `realtime` (connect, disconnect, subscribe, unsubscribe, setPresence,
  getPresence) — `service-realtime` registers zero HTTP routes and the
  dispatcher deliberately never advertises `/realtime`
- `workflow` (getConfig, getState, transition)
- `views` CRUD (list, get, create, update, delete) — no `/ui/views` route
  anywhere
- `notifications` device/preference helpers (registerDevice,
  unregisterDevice, getPreferences, updatePreferences) — the ADR-0012
  server side was never built

Each family was underwritten only by an unconsumed spec `DEFAULT_*_ROUTES`
table — the same disease `DEFAULT_DISPATCHER_ROUTES` had (#3586) — so
`DEFAULT_PERMISSION_ROUTES`, `DEFAULT_VIEW_ROUTES`, `DEFAULT_WORKFLOW_ROUTES`,
and `DEFAULT_REALTIME_ROUTES` are deleted with them;
`getDefaultRouteRegistrations()` now returns 9 registrations.
`ApiRouteType` loses its client-only `'views' | 'permissions'` extras.

Kept: `client.events` (explicitly local in-memory buffer, no HTTP),
`notifications.list/markRead/markAllRead` (dispatcher-served),
`approvals.*` (ADR-0019 — the real approval decision API), and
`meta.getLegalNextStates` (the real FSM read).

Breaking for anyone calling the removed methods — a repo-wide and
objectui-wide sweep found one consumer (`useClientNotifications`'s dead
device/preference delegates, trimmed in the objectui companion change);
shipped as minor per the launch-window convention (cf. #3562/#3581/#3595).
Re-adding any of these surfaces requires the server route to exist and a
route-ledger row proving it (#3569/#3609 guards).
