---
'@objectstack/objectql': patch
---

fix(objectql): `os migrate plan` no longer runs the activation ledger's package backfill, so it stops blaming a plugin for the platform's own upgrade write

Clause-②: no
Metadata-protocol: none

The CLI's one-shot boot (`os migrate plan` / `apply`, `os migrate stored-references` and every other command booted through `bootSchemaStack`) used to run the boot-time package backfill of `sys_metadata_activation`. On a database an earlier release left, holding a row that names no package for a packaged item, its `update()` met the declaration boot's write guard, which refused it and printed "The plugin that issued it registers a writing hook outside start() — move the write into start()", plus a plan note saying a plugin in the stack writes during boot. No such plugin exists: the write is the served boot's upgrade.

The backfill now keys on the signal the platform's other boot repairs already use: `ObjectQLPlugin`'s `runPlatformMigrations`, which `bootSchemaStack` sets to `false`. On such a boot it runs as a dry run, writes nothing and prints one line naming each row the next served boot will bind and the package it gets. A ledger the one-shot boot cannot read (for example, a plan on a database that does not exist yet) now goes to debug instead of the warning that the backfill "did not finish". `os dev`, `os serve` and `os start` bind the rows exactly as before. The write guard itself is unchanged.
