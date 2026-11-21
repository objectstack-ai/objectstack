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
  - The fix for an app author: verify a configuration that does not declare that datasource. An external datasource (`schemaMode: 'external'` or `'validate-only'`) on a plugin's driver is not affected: verify keeps its real driver and withholds its own writes from its objects, as before.

This supersedes what two earlier notes in this release say about a managed datasource "with no faithful stand-in": neither `mongodb` nor a plugin's driver keeps its real driver under `os verify` any more.
