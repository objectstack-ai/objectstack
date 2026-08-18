---
"@objectstack/objectql": patch
---

fix(objectql): `ObjectQLPlugin`'s three registry reads stop inventing an empty registry — one of them silently skipped schema sync for every object at boot (#9285)

`ObjectQLPlugin` read the registered object set in three places, all spelled
`this.ql.registry?.getAllObjects?.() ?? []`. That expression folds three
different facts into one value:

1. the registry answered, and holds no objects;
2. the engine exposes no `registry` at all;
3. the registry exposes no `getAllObjects` — a **structural** omission that
   never throws, so it is invisible precisely when it is wrong.

Only (1) is truthfully *"no objects"*. #8895 ruled this family **discriminate or
propagate**; #9002 and #9154 applied it to the two delete-cascade seams and the
roll-up summary index. This closes the same shape in the plugin, where the
consequential seam is at **boot**.

The three seams get three different answers, and the difference is the fix:

- **`syncRegisteredSchemas` — propagates.** Its next line is
  `if (allObjects.length === 0) return;`, so an invented empty answer meant **no
  registered object's schema was synced to any driver** — no table created, no
  column added — silently, at boot, with the plugin reporting a clean start.
  Failing the boot is more truthful than starting against a store whose DDL
  never ran. On the `metadata:reloaded` path the existing caller already catches
  this and reports it at `error` (#4632), so propagation there is a loud
  durability report rather than a dead kernel.
- **`reconcileFederatedBindings` — reports at `error`, then degrades.** The pass
  exists to *name* the federated objects it could not bind ("a boot with nothing
  to report says nothing"), so an unreadable registry making it report nothing
  was exactly the silence it was written to prevent. It stays exception-proof:
  it is a post-hoc reconciliation run after every `start()`, deliberately not a
  boot gate.
- **`runGovernanceInventory` — reports at `warn`, then skips.** This seam
  carried **two independent swallows** (`?.()` *and* a wrapping
  `try { … } catch { return [] }`), so a *throwing* registry was
  indistinguishable from an empty one. Feeding the audit an invented empty
  object set is worse than silence: with no objects, every handler declared *on*
  an object reconciles as an "undeclared handler … REFUSED at dispatch", so an
  unreadable registry accused a healthy deployment. The inventory is warn-only
  and exception-proof by contract, so it reports and skips instead of
  propagating, and leaves its report fingerprint untouched so the next
  successful run is not suppressed as "unchanged".

All three now read through one shared helper that throws rather than inventing,
naming the consequence; a registry that *throws* propagates its own error
verbatim.

This is a **structural** close, not a live defect — re-derived on this tree:
`SchemaRegistry.getAllObjects()` is a walk over in-memory `Map`s calling
`resolveObject()`, which returns `undefined` on every failure branch it models
and never throws, and `ObjectQL.registry` is a getter over a field-initialized
`SchemaRegistry`, so for a real engine neither optional link can short-circuit.
The reach that is real is a duck-typed `ql` — an incomplete test double, which
#9154 measured shipping in nine suites at once.

The `objectsRegistered` count in the `ObjectQL engine started` info log is
deliberately unchanged: a wrong `0` there costs one advisory line and no data.
