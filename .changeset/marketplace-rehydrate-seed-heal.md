---
"@objectstack/cloud-connection": patch
---

fix(marketplace): heal missing sample data when rehydrating installed packages onto a new database

The install ledger (`.objectstack/installed-packages/`) is anchored to the
project directory while the database can be swapped out from under it —
`os dev --fresh`, a deleted `dev.db`, a `--database` switch. Rehydrate
deliberately never re-seeds (existing rows must not be re-upserted over user
edits on every boot), which left a rehydrated marketplace package PERMANENTLY
empty on a new database: app in the switcher, tables created, zero rows — the
"HotCRM installed but every KPI is 0 / Sales Pipeline all-empty" state.

Rehydrate now runs the bundled seed datasets iff the manifest actually bundles
them, the user never explicitly purged them, the runtime is single-tenant
(multi-tenant seeding stays owned by the per-org replay), and EVERY seeded
object is empty — one surviving row anywhere means the data is still there and
nothing is touched, so the heal is idempotent across restarts and can never
revert user edits.

Also fixed along the way: a purge now stamps `sampleDataPurged` on the ledger
entry (so healed restarts respect the deliberate empty baseline), and install
marks `withSampleData: true` when the seed run reports all rows *skipped*
(already present, e.g. a reinstall over live demo data) instead of leaving the
flag false over a seeded database.
