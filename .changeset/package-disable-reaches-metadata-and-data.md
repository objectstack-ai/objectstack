---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
"@objectstack/runtime": patch
"@objectstack/spec": patch
---

fix(engine-core): disabling a package now stops its objects being served, and a failed uninstall stops answering 200 (#7557)

## Disabling a package is now an enforcement for its objects

A package at `status: 'disabled'` had its nav entries and views correctly
dropped, while `GET /api/v1/data/<object>` still answered **200 with every
row** and `GET /api/v1/meta/objects` still listed the object. The status was
consulted by some readers and skipped by others, so "disabled" meant different
things depending on which surface you asked.

Both skips were deliberate and both gave the same reason — filtering objects
"would break data queries that depend on their schema". That conflated two
different kinds of reader, and they are now separated explicitly:

- **Resolution readers keep serving.** `registry.getObject` and
  `registry.listItems('object')` still return a disabled package's objects.
  Migrations, cross-package references and the runtime authoring gate's object
  universe all resolve through them, and blanking them would break authoring
  that has nothing to do with the disabled package. Disable remains reversible
  and still destroys no data.
- **API readers now stop.** The `/meta/*` listing drops the objects (the
  `object`/`objects` exemption in `getMetaItems` is gone; `package` is still
  never filtered, or a disabled package could never be re-enabled), and the data
  plane refuses.

**The data-plane refusal is loud, not silent.** `assertObjectRegistered` — the
single gate every `findData`/`getData` entry point funnels through — now answers
a new error code:

```
404  { "error": { "code": "OBJECT_PACKAGE_DISABLED",
                  "message": "Object 'x' belongs to a disabled package and is not
                              being served. Re-enable the package to restore access." } }
```

The 404 status matches the closest existing sibling, `OBJECT_API_DISABLED` for
`enable.apiEnabled: false`, so "this object exists but is switched off" keeps
one status across both switches. The distinct **code** is what makes it
actionable: a bare `OBJECT_NOT_FOUND` sends a caller — an AI agent especially —
hunting for a typo or re-creating an object that is merely switched off, while
this one names the cause and therefore the fix. `OBJECT_PACKAGE_DISABLED` is
registered in the ADR-0112 ledger under `@objectstack/metadata-protocol`.

If you have a client that treats a disabled package's objects as queryable, it
now receives a 404 with the code above instead of rows. Re-enabling the package
restores every surface.

## A failed uninstall is no longer wrapped in a 200

`DELETE /packages/:id` on the dispatcher door stated `success: true`
unconditionally and forwarded the protocol's own `{ success: false,
deletedCount: 0 }` underneath it, so the status line and the payload disagreed
and any caller reading the status recorded an uninstall that had not happened.
Per-item failures now answer **400 `PACKAGE_DELETE_PARTIAL`**, carrying the
failed items and the uninstall cleanup outcomes (a failed permission revocation
is a ghost grant, so it must survive the failure path).

The rule is copied deliberately from the direct-mount REST door of the same
route, which already answered this way — two doors to one route answering
differently is how the divergence arrived. That includes its carve-out: **zero
metadata rows is still a successful uninstall**, because a runtime-registered
package that never published metadata has nothing in `sys_metadata`. The
failure predicate is therefore `failedCount > 0`, not `!persisted.success`.

An all-rows-failed uninstall now answers 400 rather than the 404 its zero
`deletedCount` previously implied.

**Not fixed here:** the separate persistence defect where `deletePackage` finds
zero rows while package-bound `sys_metadata` rows demonstrably exist, leaving
them behind on an otherwise-clean uninstall. That is a `sys_metadata` query
defect one layer below this handler and is reported for its own fix; see #7557.
