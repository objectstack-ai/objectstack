---
'@objectstack/objectql': patch
---

**`MetadataFacade.register('object', …)` now writes where its own object reads
look — it was a silent no-op before (#6725).**

`MetadataFacade` is exported from `@objectstack/objectql`'s root and `core`
entrypoints for hosts that want to occupy the kernel's `metadata` slot with a
`SchemaRegistry`-backed service. Its object write went through
`SchemaRegistry.registerItem`, which stores into the generic `metadata` map —
and **every one of its object reads resolves from `objectContributors`**, which
only `registerObject` populates:

- `getObject(name)` → `registry.getObject`;
- `get('object', name)` and `exists('object', name)` → `registry.getItem`, which
  special-cases the object type straight back to `registry.getObject`;
- `list('object')` and `listNames('object')` → `registry.listItems`, which
  special-cases to `registry.getAllObjects`.

So an object registered through the facade was readable back through **none** of
them: `register` resolved successfully and every subsequent read answered
`undefined` / `[]`. `IMetadataService` (`@objectstack/spec/contracts`) declares
`getObject(name)` ≡ `get('object', name)` and its own conformance test
round-trips a `register('object', …)` through both members, so this was a
shipped contract that could not work. Dormant in-tree only because nothing on
`main` installs a `MetadataFacade` into the `metadata` slot — a downstream host
that did (cloud, a third-party kernel) got the split, including the
write-then-read in ObjectQL's own `bridgeObjectsToMetadataService`, whose
"already registered?" probe would never answer and so re-registered the full
object set on every boot.

**What changed.** The facade's object write now performs *both* halves of the
two-place write the registry documents for a runtime-authored object
(`SchemaRegistry.unregisterObject`'s header states the invariant; the in-tree
precedent is `MetadataProtocol.applyObjectRegistryMutation`, which does exactly
this): `registerObject` for the contributor entry every read resolves, plus the
existing `registerItem` for the stored document. Both spellings of the type
(`'object'` and `'objects'`) are covered, because both are special-cased on the
read side.

Consequences a caller can observe:

- `getObject` / `get` / `exists` / `list` / `listNames` / `listObjects` now
  answer a facade-registered object. What they answer is the **runtime-effective**
  object the contract promises: system columns injected, primary title
  designated, `extend` contributions merged.
- An object arriving with no `_packageId` is runtime-authored by definition, so
  it is registered under the platform's `'sys_metadata'` sentinel and stamped
  `_provenance: 'org'`. It therefore does **not** read as code-shipped —
  `getArtifactItem` / `isArtifactBacked` exclude both — and does not become
  un-editable. An object carrying a real `_packageId` is registered under it and
  keeps `_provenance: 'package'`. The stored document keeps its as-authored,
  unstamped shape; only the contributor copy carries registry coordinates.
- `register('object', …)` can now **throw** where it previously succeeded and did
  nothing: claiming an object another package already owns is refused by
  ADR-0029. The contributor write runs first so a refusal writes nothing at all.
- `unregister('object', name)` removes the object from both places. Without this
  the fix would have re-opened #6808 from the other side — a removal that empties
  only the generic map leaves `getObject`, which the data plane dispatches on,
  serving a deleted object for the life of the process. It refuses, per ADR-0029,
  an object still extended by another package.

No in-tree caller changes behaviour: `new MetadataFacade(...)` appears nowhere on
`main` outside this package's own tests, and the `metadata` slot is filled by
`MetadataManager` or `createMemoryMetadata`, both of which already round-tripped
correctly.
