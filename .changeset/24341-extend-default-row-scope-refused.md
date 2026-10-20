---
'@objectstack/objectql': minor
---

fix(objectql)!: the registry refuses an `extend` contribution that carries `defaultRowScope` (#24341)

Clause-②: no (narrowing)

An object's default row scope is declared by the object's owner alone. `SchemaRegistry.registerObject` now refuses an `extend` contribution that carries `defaultRowScope`, whatever its value and whatever the target, with `INVALID_METADATA` (`status: 422`) and the error name `ExtensionDefaultRowScopeRefusedError`, naming the object and the extending package. It is refused before the contribution is recorded, so nothing of it lands, and the owner's declaration stays in force.

Every value is refused because no narrower line holds. Whether one row predicate admits more rows than another cannot be decided in general, so a "loosening" cannot be told from a "narrowing". And the extension merge never carried the key onto the object, so an accepted one restricted nothing while its author believed it did.

**BREAKING — what moves for consumers.** This is an accept-set narrowing on the registry's `extend` door, shipped as `minor` under the launch-window convention for accept-set narrowings.

- FROM: `registerObject(def, packageId, undefined, 'extend')` with `def.defaultRowScope` set registered the contribution and dropped the key.
- TO: it throws `INVALID_METADATA` (`422`, `ExtensionDefaultRowScopeRefusedError`).
- Fix: remove `defaultRowScope` from the extension. To scope the rows the holders of a permission set read on the object, give that set a `rowLevelSecurity` policy for it.

**Unchanged.**

- An `extend` contribution that leaves the key out, or sets it to `undefined`, registers and folds as before. The one shipped `extend` of a platform object in this repository (`@objectstack/plugin-auth`'s `sys_sso_provider` extension) registers, measured on a booted composition.
- A manifest's `objectExtensions` entry never reaches this refusal: its schema is strict and refuses the key at authoring, and `ObjectQL.registerApp` copies a closed key list off each entry.
- The owner's own `defaultRowScope` registers and re-registers as before.
- No export moves: the error class is not exported, and its code is the existing `INVALID_METADATA`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the registry's extend door of a key the extension merge never carried: no authorable key, spelling, export or stored shape moves, and the manifest path already refuses the key at authoring. The repair is removing the key from a programmatic extend call, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not an interface, a type or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
