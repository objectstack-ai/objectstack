---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a migrate-and-exit boot (`OS_MIGRATE_AND_EXIT=1`) no longer provisions the development admin, whatever `NODE_ENV` says

Clause-②: no

- **What changed.** `objectstack serve` reads `OS_MIGRATE_AND_EXIT` only after the kernel bootstrap, and the dev-admin seed runs on `kernel:ready`, inside that bootstrap. So a migration run with `NODE_ENV=development` seeded exactly as a dev boot does: run against an empty database, it left a known-credential login behind. `isDevAdminSeedArmed()` now answers "not armed" when `OS_MIGRATE_AND_EXIT` is `1`, the same spelling `serve` exits on, and the clause wins over an explicit `OS_SEED_ADMIN=1`. A migrate-and-exit boot of an empty database now creates no `sys_user` row and no `sys_account` row.
- **The walled owner check follows.** It reads the same function, so on a migration run the seed no longer counts as a way to verify a declared platform owner. A walled migrate-and-exit boot of an empty database completes its schema sync as before; it just seeds no login.
- **Unchanged.** The `objectstack dev` seed: still armed under `NODE_ENV=development` on a database with no login, and still off under `OS_SEED_ADMIN=0`. Any `OS_MIGRATE_AND_EXIT` value other than `1` is a boot that goes on to serve, and keeps its seed. A database that already holds a login was never seeded and is not touched.
- **If a pipeline relied on the seed.** Create the first account through the deployment's own provisioning path after the migration step, as a production deployment does.
