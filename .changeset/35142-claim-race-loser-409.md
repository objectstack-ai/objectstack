---
'@objectstack/objectql': patch
---

fix(objectql): the loser of a concurrent update answers 409 CONCURRENT_UPDATE on any update that opens its own unit of work

Clause-②: no
Metadata-protocol: none

Two members of a queue claiming the same parked record at the same moment get one success and one `409 CONCURRENT_UPDATE`, as ADR-0142 D4 says, on every object. On a single-connection store such as SQLite, the loser got `404 RECORD_NOT_FOUND` (private sharing) or `403 PERMISSION_DENIED` (public read) instead whenever the update opened its own unit of work. An update does that in two cases, and the wrong answer has a different history in each:

- The object carries a metadata `beforeUpdate` hook. This case opens the unit since 18.6.0, so the loser answered 409 in 18.5.0 and 404 / 403 in 18.6.0. It answers 409 again.
- The object carries a blocking (`onError: abort`, the default) or conditioned metadata `afterUpdate` hook. This case already opened the unit in 18.5.0, so the loser answered 404 / 403 in 18.5.0 and 18.6.0. It now answers 409.

The stored owner was always right; only the loser's answer was wrong.

The cause: the unit exists so that a refusal later in the write rolls back what the write's hooks wrote through `ctx.api`, the row included. That unit opened around the whole update, the authorization middleware included. On SQLite the second writer then waited for the first one's commit before its authorization gate read the record, and by then the record belonged to someone else. The unit now opens around the engine body only: the middleware runs before it, as it does for an update that opens no unit, and the hooks, the row write and the `after*` chain still run inside it and still roll back together.

What a middleware does after `next()` on such an update now runs after the commit, as it does on an object with no metadata update hook. For the `beforeUpdate` case that is how 18.5.0 behaved. For the `afterUpdate` case it is a change from every earlier release, where that code ran inside the unit.

Nothing to change in an app.
