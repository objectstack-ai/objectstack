---
"@objectstack/objectql": patch
"@objectstack/runtime": patch
---

fix(objectql): the discrete transaction trio joins an open ambient transaction, so a sandbox body no longer opens a second one (#6406)

#6168 taught the callback face (`ctx.api.transaction(fn)` on `ScopedContext`)
the ADR-0067 D2 join. It could not reach the SANDBOX face: a QuickJS hook or
action body's `ctx.api.transaction(fn)` is VM-side sugar over three host leaves
(`__txBegin` / `__txCommit` / `__txRollback`) that drive `ScopedContext`'s
discrete `beginTransaction` / `commitTransaction` / `rollbackTransaction` trio —
a different method, which had no join branch of its own. So a body running
inside a host `engine.transaction()` still opened a SECOND driver transaction:

1. it asked the pool for a second connection — the deadlock D2 exists to avoid
   on a single-connection pool (knex/SQLite); and
2. it committed itself, so its writes SURVIVED the outer rollback. The caller
   was told the unit of work had been undone while some of its rows were still
   there — no error, no log.

`beginTransaction()` now makes the same first move as both callback faces:
before looking a driver up it reads the engine's ambient transaction store, and
where one is open it returns THAT handle in a child context, with `owned: false`
in its result (#5696's signal, in the shape this face can carry it).
`commitTransaction` and `rollbackTransaction` abstain for such a handle, so the
outer caller keeps the one and only commit/rollback. An explicit rollback of a
joined handle performs no driver rollback: that is the same answer the callback
faces give, where the joined branch has no rollback either and a throw
propagates to the outer owner, which rolls the whole unit back. In the sandbox
that path is exact — the sugar's catch reaches `__txRollback` and RE-THROWS, so
the body's failure travels out to the host owner.

The abstention lives on `ScopedContext`, not in the caller, so no trio caller
can close a transaction it does not own. The QuickJS runner additionally
honours the `owned` bit at all three of its close paths (commit leaf, rollback
leaf, and the teardown cleanup that rolls back a transaction a timed-out body
left open) — the runner closes what the runner opened.

Measured, not assumed: at `__txBegin` time the engine's ambient store IS
readable from the sandbox leaf (the leaf runs on a chain awaited down from the
host's `txStore.run`), which is why no separate capture mechanism is needed.
What the trio still cannot do is PUBLISH — with no closure spanning
begin→commit there is nothing to hand `txStore.run` — so a transaction it opens
itself stays invisible to ambient readers, exactly as before, and the #6167
surface (handles the engine cannot attribute) is unchanged.
