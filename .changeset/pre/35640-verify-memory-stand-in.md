---
'@objectstack/verify': patch
---

fix(verify)!: a managed `mongodb` datasource runs on verify's in-memory stand-in, and a managed datasource on a plugin's driver id refuses the boot

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or export is added, removed, renamed or re-shaped, and no stored row changes. What moves is what `os verify` (and `bootStack`) does with a datasource an app already declares: a managed `mongodb` one is built in memory instead of on its real connection, and a managed one on a driver id the platform does not ship refuses the boot. There is nothing for a migration to rewrite and no tombstone. -->

Verify writes only to stores it creates. Until now that held for a managed datasource on a SQL engine or `memory`, but not for one on `mongodb` or on a driver id a plugin supplies: those kept their real driver, verify withheld only its own writes from their objects, and the app's seed, hooks and flows still wrote to the real database during the run, where verify could neither identify nor undo the rows it changed.

- **`mongodb`, and every other engine the platform ships.** A declared managed datasource (`schemaMode: 'managed'`, or none declared) on any driver id the platform ships, `mongodb` included, now runs on verify's ephemeral in-memory stand-in, the same store verify builds for the SQL engines: nothing of its declared connection is used, every write to its objects (verify's and the app's seed, hooks and flows) stays in memory, and its objects are exercised by every derived family. The CRUD report no longer lists them as `managed datasource "NAME" (driver "mongodb"): not exercised`.
- **BREAKING: a managed datasource on a plugin's driver id refuses the boot.** Such a datasource cannot be stood in: the plugin builds and registers its own driver, and the boot would write through it. `os verify` now refuses to boot while one is declared (any name other than `default`), before anything is composed. The refusal names each such datasource and its driver id, says why, and `os verify` exits 1 with it.
  - FROM: `os verify` booted the app, left the datasource's objects out of its own write families, and let the app's seed, hooks and flows write to the real database behind the plugin's driver.
  - TO: `os verify` refuses to boot, naming the datasource and the driver id. There is no flag, boot option or metadata key around the refusal.
  - The fix for an app author: correct the driver id if it is a misspelling, or verify a configuration that does not declare that datasource.
- **BREAKING: a plugin driver registered under a managed datasource's name refuses the boot.** The datasource connection service keeps a driver already registered under a datasource's name, whatever driver id the datasource declares, so a plugin that registers a driver under a managed datasource's name on a shipped id (`mongodb`, `postgres`, …) would have run it on the plugin's driver. `os verify` now refuses that boot, naming the datasource and its declared driver id, when the driver is registered before verify's stand-in holds the name: as a `driver.*` service (matched by its key and by the driver's own name, before any plugin starts), or into the engine from an `objectql:drivers-ready` handler or anywhere else (refused at the engine's `registerDriver`, before the engine holds it). Either way no connect, schema sync or write reaches the plugin's driver. A driver registered under the name once the stand-in holds it (an app plugin's `start()`, a `runtime.onEnable` bridge) is discarded by the engine, as before, and that boot runs on the stand-in.
  - FROM: when the plugin's driver took the datasource's name before verify's stand-in did, `os verify` booted on it, and the app's seed, hooks and flows (and, for a SQL id, verify's own writes) reached the store behind it.
  - TO: `os verify` refuses that boot, even when the plugin catches the refusal and carries on. No flag, boot option or metadata key around it.
  - The fix for an app author: verify a configuration whose plugins do not register a driver under a managed datasource's name. An external datasource (`schemaMode: 'external'` or `'validate-only'`) on a plugin's driver is not affected: verify keeps its real driver and withholds its own writes from its objects, as before.

This supersedes what two earlier notes in this release say about a managed datasource "with no faithful stand-in": neither `mongodb` nor a plugin's driver keeps its real driver under `os verify` any more.
