---
"@objectstack/spec": minor
---

feat(spec)!: `defineStack`, `os validate` and `os build` refuse a collection item whose body `_packageId` names a package other than the one that ships it

The stack schema (`ObjectStackDefinitionSchema`) now judges every item of the collections the registration door files under their package (`OWNER_STAMP_JUDGED_COLLECTIONS`: connectors, flows, views, actions, permission sets, seed `data` and the rest) and raises an issue at the item's `_packageId` when the body carries a stamp other than the package that ships it: the stack's `manifest.id` (no package without a manifest), or for a release artifact each `packages[]` body's own `id`, with a top-level item no body declares judged against `manifest.id`. `defineStack` answers `STACK_SCHEMA_INVALID` / 422; `os validate`, `os build` and the artifact door's parse report the located issue. The judge is one pure function, `judgeCollectionItemOwnerStamp` (`@objectstack/spec/kernel`), which `@objectstack/objectql`'s registration refusal calls too, so the build door and the boot cannot disagree.

Clause-②: no (narrowing) — the stack schema refuses a collection item whose body `_packageId` names a package other than the one that ships it, which it parsed before and the registration refused only at boot or install. Nothing is widened.

Metadata-protocol: narrowed (a collection item's `_packageId`, declared by `MetadataProtectionFields`, is refused at the build doors unless it is absent or names the package that ships the item)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed, and no value a legitimate producer writes is refused: the registration is the only writer of `_packageId` (`os build` writes none, the package export strips every underscore key), and a stamp equal to the shipping package is still accepted. A foreign stamp exists only in a body somebody wrote by hand, which the registration door already refuses at boot or install; this moves the same refusal to where the body is written. A conversion could not tell a foreign stamp from an agreeing one without the owner that judges it, and the refusal names the item, both values and the remedy. -->

**BREAKING** accept-set narrowing at the build doors (`@objectstack/spec`), shipped as `minor`.

- **Before.** `defineStack({ manifest: { id: 'com.acme.app', … }, connectors: [{ name: 'billing', …, _packageId: 'com.acme.host' }] })` parsed, and `os validate` exited 0; `ObjectQL.registerApp` refused the stack at boot or install with `VALIDATION_ERROR` / 400 at `_packageId`.
- **Now.** The parse raises an issue at `connectors.0._packageId` whose message starts "Drop `_packageId` from connector 'billing'", names the stamp and the package that ships the item, and `os validate` / `os build` exit 1. `''` is refused the same way; `null` is refused by the item schema's own type check at the same key.
- **Unchanged.** An absent `_packageId` and one equal to the shipping package parse as before. Objects, object extensions, apps, picklist extensions, datasources, datasource mappings and translations are not judged at either door. A top-level copy of a `packages[]` body's item is not judged against the artifact's id. A stack's `plugins` (runtime plugin instances) are not read by the parse; the registration door judges a nested plugin's items when it registers them.
- **Who sees it.** Whoever hand-writes `_packageId` on a stack item naming another package, or on any item of a stack with no `manifest`, which no build, export or install writes.

**The remedy.** Drop `_packageId` from the body. The package an item belongs to is the one that ships and registers it, stamped by the registration.
