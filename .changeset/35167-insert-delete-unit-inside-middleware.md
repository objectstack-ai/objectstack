---
'@objectstack/objectql': patch
---

fix(objectql): insert and delete open their own unit of work around the engine body, as update does

Clause-②: no
Metadata-protocol: none

An insert or delete opens its own unit of work when the object carries a metadata `before*` hook on that verb, or a blocking (`onError: abort`, the default) or conditioned metadata `after*` hook. The unit exists so that a refusal later in the write rolls back what the write's hooks wrote through `ctx.api`, the row included. Update moves that unit around the engine body only in this same release; insert and delete opened it around the whole write, the middleware chain included. All three verbs now follow one rule: the middleware chain, the authorization gate included, runs before the unit opens, and the hooks, the row write and the `after*` chain run inside it and still roll back together.

What changes for an insert or delete on such an object:

- On a single-connection store such as SQLite, a writer whose authorization gate or middleware is still running no longer holds the store's only connection, so other writers are no longer queued behind it.
- What a middleware does after `next()` now runs after the commit, as it already does for an update and for an insert or delete on an object with no such hook. A middleware that throws after `next()` no longer rolls the row back on a hooked object; it never did on any other object.

The answer the loser of two concurrent deletes of one row gets is unchanged by this patch.

Nothing to change in an app.
