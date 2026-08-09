---
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(objectql): deleting an `object` really unregisters it — a name-addressed `SchemaRegistry.unregisterObject` (#6808)

Deleting a runtime-created `object` removed its `sys_metadata` row and left the
object serving. `deleteMetaItem` ends its repository delete with
`restoreArtifactRegistryView` (the #6687 three-tier heal), and every verb that
walk uses — `removeRuntimeShadow`, `registerItem`, `removeOverlayEntry` —
addresses `SchemaRegistry`'s generic `metadata` map. An `object` is written into
**two** places on the way in:

```ts
registry.registerItem('object', item, 'name');                 // metadata map
registry.registerObject({ ...item, _provenance: 'org' }, pkg);  // objectContributors
```

The heal only undid the first. Measured with the real `SysMetadataRepository`
over an in-memory engine:

```
BEFORE delete: metadata['object'] -> ["myapp_invoice"] | objectContributors -> ["myapp_invoice"]
AFTER  delete: metadata['object'] -> []                | objectContributors -> ["myapp_invoice"]
registry.getObject('myapp_invoice')        -> STILL SERVED
registry.getItem('object','myapp_invoice') -> STILL SERVED   (it special-cases back to getObject)
```

The surviving half is the load-bearing one. `getObject` is what the data plane
dispatches on (`assertObjectRegistered`, #3770), so the row was gone from
`sys_metadata` while the object stayed resolvable, syncable and **writable** for
the life of the process — a `createData` against the deleted object still
inserted rows. Reachable on the ordinary Studio delete path, and on
`revertCommit`'s soft-remove limb, which #6807 had just wired to the same heal.

There was no one-line fix because `SchemaRegistry` had no per-name object
removal at all: the only removal verb was `unregisterObjectsByPackage`, which is
addressed by PACKAGE. Routing a single delete through it would mean synthesising
a package identity for a runtime-created object and tearing down every sibling
object registered under it — a far wider blast radius than the delete the
operator asked for.

So `SchemaRegistry` gains the verb that was missing:

- **`unregisterObject(name, { force? })`** — removes one object's contributor
  entry and the per-object state `registerObject` created (merged-object cache,
  `objectRevision`). Names resolve through the same path `getObject` uses, so it
  removes precisely the entry that was being served. Package namespaces are left
  alone: they are per-package and shared by every object that package ships.
- **The ADR-0029 guard is borrowed, not re-invented.** An object still extended
  by another package refuses loudly, naming every extender — the same judgement
  `unregisterObjectsByPackage(force)` already encodes, with the address changed
  from package to name. Both facts it needs (owner, extenders) were already in
  the contributor list, so no new bookkeeping was added.

`restoreArtifactRegistryView` calls it from **tier 3 only**, and only for a name
that is not artifact-backed — the tier that has already established no lower
layer serves the name. Tiers 1 and 2 concluded a
packaged artifact or a MetadataService baseline still does, and an object that is
still served must stay registered: `assertObjectRegistered` fails CLOSED, so
retiring it there would turn "reset to artifact default" into a data-plane
outage. It also carries the same artifact refusal `removeOverlayEntry` applies
one line up, asked through the protocol's own `isArtifactBacked`: a code-shipped
object is never retired by this walk. That is not already covered by the gates in
front of it — the two-tier delete authorization runs only when `environmentId !==
undefined`, and the no-row leg of a control-plane delete reaches the heal without
touching the repository's `assertAllowed` at all.

Because the heal runs after the repository delete has committed, an extender
refusal is caught and logged by name rather than propagated (the row is gone
either way) — and deliberately not left to the heal's silent outer `catch`, so a
runtime that disagrees with `sys_metadata` is visible rather than inferred.

`unregisterObjectsByPackage` keeps its signature and semantics unchanged.
