---
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': minor
'@objectstack/platform-objects': minor
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/plugin-audit': minor
---

fix(metadata-protocol,runtime): a seed row a person deleted is no longer inserted again under a new id by the next seed replay

Clause-②: yes (widening)
Metadata-protocol: semantic

A seed replays long after its first load: on every boot of a single-tenant runtime (`objectstack serve`, `os start`) and per organization whenever a host replays the seed union, for example on a package upgrade. The create-only default (`mode` omitted, which is `ignore`) inserted every declared row it did not find, and `upsert` did the same. A row a person deleted therefore came back under a new id at the next replay.

The seed loads AppPlugin runs now keep a per-organization record of which seed rows landed: the boot seed, the per-organization replay (the `seed-replayer` service) and the dev hot-reload seeder. The record is the new platform object `sys_seed_landed_key` (`SysSeedLandedKey`, registered by `PlatformObjectsPlugin`). It holds one row per landed key: the organization, the object, and the dataset's `externalId` fields with the values the row was matched by. The loader records every keyed row an `upsert` or `ignore` dataset lands, whether it inserted the row, updated it or matched it and left it alone. A row an earlier release seeded therefore counts as landed from the first load after the upgrade. A missing row is inserted only when its key never landed in that organization:

- A deleted seed row stays deleted across reboots and upgrades. A row an upgrade adds to the seed still lands.
- An edited row is left as the person left it. Under `ignore` this includes a renamed key: the old name is not inserted again.
- A reference to a removed row is left as it is, and a row whose own key names a removed row is withdrawn with it. Nothing is reported unresolved for either, so a replay after a person's delete still loads clean.
- One `info` line per load says how many seed rows were not inserted again, and where.

The deliberate re-seed is the `seed-replayer` service called with `{ reseed: true }`. It inserts every missing row, including the ones a person removed, and records them again. A new database starts with an empty record. Deleting an organization deletes its record.

`SeedLoaderService` takes the record through a new constructor option, `landedKeys: 'honour' | 'reseed'`. A caller that does not pass it neither reads nor writes the record, so the package publish, marketplace install, reseed and purge doors behave as before. A load keeps no record when it seeds no organization, and says so at `info`. It also keeps none when the composition does not register `sys_seed_landed_key`, and says so at `warn`. A record write that fails is reported once at `error`. It fails neither the rows nor the load, and the next load records every row that is still present.

`PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` in `@objectstack/spec` lists the new object, and so do `PLATFORM_PROVIDED_OBJECT_NAMES` and `isPlatformProvidedObjectName`, so a stack that references `sys_seed_landed_key` resolves it instead of drawing the unknown-platform-name advisory. `@objectstack/plugin-audit` leaves `sys_seed_landed_key` out of `sys_audit_log` and `sys_activity`: recording which seed rows landed writes no ledger row of its own, and the seeded rows stay audited. `os migrate organization-ownership` inventories the new table as organization-owned rows (fate 3, attribution), each written with the organization its load seeds.
