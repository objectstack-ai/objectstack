---
'@objectstack/objectql': patch
---

fix(objectql): the loser of a concurrent update answers 409 CONCURRENT_UPDATE again on an object with a metadata `beforeUpdate` hook

Clause-②: no
Metadata-protocol: none

Two members of a queue claiming the same parked record at the same moment again get one success and one `409 CONCURRENT_UPDATE`, as ADR-0142 D4 says. Since 18.6.0, on a single-connection store such as SQLite, the loser got `404 RECORD_NOT_FOUND` (private sharing) or `403 PERMISSION_DENIED` (public read) whenever the object carried a metadata `beforeUpdate` hook. The stored owner was always right; only the loser's answer was wrong.

The cause: a write on such an object opens its own unit of work, so that a refusal later in the write rolls back what a `beforeUpdate` hook wrote through `ctx.api`. That unit opened around the whole update, the authorization middleware included. On SQLite the second writer then waited for the first one's commit before its authorization gate read the record, and by then the record belonged to someone else. The unit now opens around the engine body only: the middleware runs before it, as it does for an update that opens no unit, and the hooks, the row write and the `after*` chain still run inside it and still roll back together.

What a middleware does after `next()` on such an update now runs after the commit, as it does on an object with no metadata hook.

Nothing to change in an app.
