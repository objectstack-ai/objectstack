---
"@objectstack/objectql": minor
"@objectstack/metadata": minor
"@objectstack/spec": minor
---

fix(objectql,metadata,spec)!: a package's apps and objects never name their own owning package — the owner-stamp refusal covers `objects` and `apps` at every door

The owner-stamp judge (`judgeCollectionItemOwnerStamp`, `@objectstack/spec/kernel`) now covers the two collections a package body files through verbs of their own, `objects` and `apps`, which it did not judge before. Each refusal is `VALIDATION_ERROR` / 400 with `issues[]` at `_packageId`, in the judge's words:

- **`ObjectQL.registerApp`** refuses an `objects` entry (array or name-keyed map), an `apps` entry, or the manifest registered as its own app, whose body carries a `_packageId` other than the registering package. It refuses before the body registers anything, so no package record, object or app is left behind. A nested plugin's objects and plugin-as-app are judged against the parent package the same way.
- **The `manifest` service's residual registration** refuses a residual object's stamp before any residual object registers. It already refused a residual app's.
- **The metadata plugin's body registration** (`@objectstack/metadata`: the artifact door and a config boot's residual) refuses a judged collection's item before it stamps and stores it. The engine's boot sync files every `app`, `view`, `flow` and `hook` it reads back under that stamp.
- **The stack schema** (`defineStack`, `os validate`, `os build`) judges `objects` and `apps` too (`OWNER_STAMP_JUDGED_COLLECTIONS` gains both), so the build door refuses what the boot refuses.

Clause-②: no (narrowing) — package registration, the metadata plugin's body registration and the stack schema refuse an object or app whose body `_packageId` names a package other than the one that registers it, which they accepted before with the body's stamp kept. Nothing is widened.

Metadata-protocol: narrowed (an object's or app's `_packageId`, declared by `MetadataProtectionFields`, may no longer name a package other than the one that registers it)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed, and no value a legitimate producer writes is refused: the registration is the only writer of `_packageId` (`os build` writes none, the package export strips every underscore key, the artifact loader stamps with the very id the registration keys on), so a foreign stamp on an object or app exists only in a body somebody wrote by hand to claim another owner. A D2 conversion could not tell such a stamp from an agreeing one without the registration that judges it, and the refusal names the item, both ids and the remedy. -->

**BREAKING** accept-set narrowing at package registration and the build door (`@objectstack/objectql`, `@objectstack/metadata`, `@objectstack/spec`), shipped as `minor`.

- **Before.** An installed manifest `com.acme.app` whose `apps[0]` carried `_packageId: 'com.acme.host'` registered the app filed under the host. `GET /api/v1/meta/app?package=com.acme.host` listed it, `?package=com.acme.app` listed nothing, and disabling `com.acme.app` kept serving the app while its objects answered 404. An object's body stamp was kept on its definition.
- **Now.** The registration throws before anything of the package registers. Through `POST /api/v1/marketplace/install-local`, an inline install answers `422 PLUGIN_REGISTER_FAILED` with that message and persists nothing. `defineStack` / `os validate` report the same stamp as an issue at `objects.N._packageId` or `apps.N._packageId`. On upgrade, a config boot whose stack carries such a stamp fails to start with the judge's message, and a package installed earlier that carries one is not loaded at the next start and is reported at `error`.
- **Unchanged.** An absent `_packageId`, or one equal to the registering package, registers as before. An app object that an earlier registration stamped in place, such as a module constant handed to a second registration, registers as it always has. `objectExtensions` are not judged.
- **Who sees it.** Only someone who hand-writes `_packageId` on an object or app naming another package. No build, export or install writes one.

**The remedy.** Remove `_packageId` from the object or app. The package an item belongs to is the one that registers it, stamped by the registration.
