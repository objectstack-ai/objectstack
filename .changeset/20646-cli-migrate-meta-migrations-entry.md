---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta` takes the migration chain from `@objectstack/spec/migrations` (#20646)

`@objectstack/spec` moved the ADR-0087 migration chain and change-manifest names (`applyMetaMigrations`, `composeSpecChanges`, `MigrationFloorError`, `MIGRATION_MAJORS`, `MIGRATION_SUPPORT_FLOOR`, …) off the package root into the new `@objectstack/spec/migrations` entry, so the command now imports them from there. It replays the same chain and prints the same guidance; nothing a user types or reads changes.
