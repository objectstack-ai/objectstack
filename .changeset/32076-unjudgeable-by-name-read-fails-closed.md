---
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol)!: `?package=`, the qualified path and `_env` name the exact holder for every package-scoped type, and a by-name read the registry cannot judge fails closed (ADR-0150 D3/D5)

Clause-②: yes (narrowing) — the by-name `/meta` read's accept-set narrows: a read naming a holder (`?package=X`, `/meta/:type/:ns/:name`, `/meta/:type/_env/:name`) that does not hold the name is refused for the package-scoped types ObjectQL's registry still reads through `getItem`, where it was served another holder's item; and a read an engine's registry cannot judge is refused instead of being answered by first match.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which item a by-name read answers, and the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** accept-set narrowing at the by-name metadata read (`@objectstack/metadata-protocol`), served by both transports (the REST route manager and the runtime dispatcher).

1. A read that names a holder of a flow, action, hook, job, webhook, connector, permission, sharing rule, queue, assignment rule or email template that does not hold the name was served another holder's item (the registry's first match): `?package=X` on `GET /meta/:type/:name`, the qualified path `GET /meta/:type/<X's namespace>/:name`, and `GET /meta/:type/_env/:name` for a name only packages hold. Each is now `409 RESOURCE_CONFLICT` with every holder in `details.candidates` (the environment among them when it holds the name), as the types the registry reads by package already were. A name nobody holds is still `404`. A customization pair still reads its base's items, the base's address still serves its pair's override and added bundle member, and the holder's own read is unchanged.
2. On an engine whose registry has no package-scoped resolver (no `packageScopedHoldersOf`, `getEnvironmentScopedItem` and `getPackageScopedItem`, or no `readsByPackage`), a by-name read of a package-scoped type that names a holder, or names none, could be answered by first match, which may be another package's item. It is now `501 NOT_IMPLEMENTED` with a sentence naming the cause. So is a read naming no package of an `agent` or `skill`, whose names are scoped to the namespace, on a registry that reads those types through `getItem`. The 501 is a declared refusal, so the runtime dispatcher answers it instead of falling through to the by-name `MetadataService` read.

The layered read (`GET /meta/:type/:name/layers`) now asks whether the item belongs to a disabled package at the member it reads, where it asked with no member (`@objectstack/rest`, `@objectstack/runtime`). So under item 1, a dependent's added email template locale read with `?package=<dependent>&member=<locale>` is judged at that locale, and its layers are served.

Every composition in this repository mounts the metadata protocol on an ObjectQL engine, whose `SchemaRegistry` carries the resolver and reads `agent` and `skill` by package, so item 2 changes no answer in it. A read naming no package of these types keeps its prefer-local answer. `NAMESPACE_SCOPED_BARE_NAME_TYPES` and `isNamespaceScopedBareNameType` move from `@objectstack/objectql` to `@objectstack/core`; `@objectstack/objectql` re-exports both, so no import changes.

The fix for each:

- FROM `?package=X` (or `/meta/:type/<X's namespace>/:name`) for a name X does not hold TO the holder the refusal names: `?package=<holder>`, `/meta/:type/<holder's namespace>/:name`, or `/meta/:type/_env/:name` for the environment's own item.
- FROM `/meta/:type/_env/:name` for a name only packages hold TO `?package=<holder>` or the holder's qualified path.
- FROM mounting the metadata protocol on an engine whose registry has no package-scoped resolver TO mounting it on an ObjectQL engine.
