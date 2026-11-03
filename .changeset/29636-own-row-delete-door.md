---
'@objectstack/core': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-auth': patch
---

refactor(core): the unreact door and the personal-view delete door are served by one own-row delete door

Clause-②: no
Metadata-protocol: none

A move with no change in what either door answers. `DELETE /api/v1/comments/reactions/:id` (`@objectstack/plugin-audit`) and `DELETE /api/v1/personal-views/:id` (`@objectstack/plugin-auth`) were two hand-copied spellings of one sequence: resolve the caller, refuse anonymous, a held sign-in and any query parameter, read the row as the caller (`404` when it cannot be read), check its owner column (`403` when it names someone else), then remove it as the system, attributed to the caller and inside the caller's organization. That sequence now lives once, in `@objectstack/core`:

- `registerOwnRowDeleteRoute(http, door, deps)` mounts the door for one object; `door` (`OwnRowDeleteDoor`) names the route, the object, the owner column and the words its answers use.
- `removeOwnRow(engine, door, id, context)` is the read, the owner check and the attributed system removal on their own.
- `ownRowDeleteCallerResolver(sources)` is the door's caller resolution over `resolveRequestExecutionContext`.

Each plugin keeps its route, its route ledger and its existing exports. Nothing to migrate.
