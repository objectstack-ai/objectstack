---
'@objectstack/cloud-connection': patch
'@objectstack/spec': patch
---

fix(cloud-connection): a sample row a tenant deleted stays deleted when install-local reinstalls, upgrades, heals or replays the package

Clause-②: no (the door starts honouring the loader's existing `landedKeys` guard, #31021; no accepted shape or public export widens; the dev confirms)
Metadata-protocol: none

install-local's seed loads now keep, and honour, the per-organization record of which seed rows landed (`sys_seed_landed_key`, registered by `@objectstack/platform-objects`). Before, the door built its seed loader without the `landedKeys` option, so it neither read nor wrote that record: a seed row a person deleted (a demo account, a demo order) was inserted again by the next reinstall, upgrade, restart heal or per-organization replay.

- The install and the upgrade (in the installing person's organization under an organization wall, otherwise in the install's sole organization), the restart heal of an empty database, the per-organization replay of a new organization and an unmanaged copy's first load honour the record: a seed row whose key landed in that organization before and whose row is now gone is not inserted again. A key that never landed still lands, so a row an upgrade adds to the seed is inserted, and a new database, which holds no record, is healed whole. A row the record keeps out is counted in `skipped`.
- The sample-data reseed (`POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data`, for a ledgered package and for an unmanaged copy alike) is the deliberate re-seed: it inserts every missing row whatever the record says, and records it again. Its answer is unchanged.
- The `seed-replayer` service this door registers when no app has registered one now takes `{ reseed: true }`, as the AppPlugin replayer does: that call inserts every missing row; any other call honours the record.

Every row a load lands is recorded, whether it inserted, updated or matched the row. Rows a person deleted before this release come back once, on the first load after the upgrade, and stay deleted from then on.

`@objectstack/spec`: the `mode` description of a seed dataset no longer says a package install keeps no record: a seed publish is the load that keeps none, and the sample-data reseed is named beside `seed-replayer(organizationId, { reseed: true })` as the deliberate re-seed.
