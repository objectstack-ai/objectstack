---
"@objectstack/objectql": patch
---

fix(objectql): `ctx.api.transaction()` joins an open ambient transaction instead of opening a second one (#6168)

`ObjectQL.transaction()` has always started with the ADR-0067 D2 join: if an
ambient transaction is already open, it runs the callback inside that one and
reports `owned: false` rather than beginning a nested driver transaction.
`ScopedContext.transaction()` — the second implementation of the same
primitive, reached as `ctx.api.transaction(fn)` from hook and action bodies —
did not. It went straight to the default driver and called `beginTransaction()`
unconditionally.

Its own TSDoc called it "a second implementation of the same thing" and lined
up against ADR-0119 D1's caveats one by one; the join was the single point that
never got aligned. That is now fixed, with the same branch, in the same
position — before the driver lookup and before `opts.require`, because an
ambient transaction *is* a transaction and a caller who declared they cannot run
without one is served by joining it.

**Behaviour change — a nested sandbox/hook transaction now rolls back with the
outer one.** Previously a hook fired from inside an `engine.transaction()`
whose body called `ctx.api.transaction(fn)` got a **separate** driver
transaction. That transaction committed itself, so its writes **survived a
rollback of the outer one**: the caller was told the unit of work had been
undone while some of its rows were still there, with nothing failing and
nothing logged. It also took a second connection for the duration — the
deadlock ADR-0067 D2 exists to avoid on a single-connection pool such as
SQLite's. After this change the inner call joins, writes on the outer handle,
and is undone by the outer rollback.

If you have a hook or action body that used `ctx.api.transaction()` inside a
larger transaction *specifically* to get an independently-committing unit —
an audit trail that must outlive a rollback, say — it no longer does. The
supported way to have a write survive a rollback is the ADR-0057 §3.6 system
ledger carve-out (`lifecycle.class` of `audit` / `telemetry` / `event`), which
routes the row to its own datasource and executes it outside the transaction by
decision rather than by accident.

The callback's `owned` signal (#5696) now reports `false` on this path, as it
already did on the engine surface. It was never wrong before — this surface
really did always open its own transaction — but what it honestly described was
the defect.

Two limits stay as they are, and are now stated in the method's TSDoc. The join
reads the engine's ambient `AsyncLocalStorage` store only, so the discrete
`beginTransaction`/`commit`/`rollback` trio — which deliberately never
populates that store, because its handle is threaded explicitly across
`setImmediate` boundaries — is invisible to it and is not joined. That is what
keeps the branch from mistaking an explicitly-threaded handle for an ambient
one. The QuickJS sandbox drives its VM-side `ctx.api.transaction(fn)` through
that trio rather than through this method, so a VM-side body is outside this
join; unattributable handles are tracked separately in #6167.
