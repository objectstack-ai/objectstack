---
'@objectstack/spec': minor
---

feat(spec): `adr-0030-notification-event` joins `CREATION_ATTESTED_MIGRATION_IDS`, and its docblock states what a run may claim in the `sys_migration` ledger (maintainer ruling 2026-09-05 on #15710)

The ADR-0030 notification-convergence migration id was registered so that
"has this cut-over run here?" is answerable at all, with its ledger semantics
deliberately left open on the constant. The maintainer has now ruled them
(decision batch #47 item 5, verbatim 「同意」 — the question batch #21 reserved),
and this release lands the spec half:

- **Creation-attested.** A datastore created after the cut-over has no legacy
  `sys_notification` inbox rows by construction, so the id is now a member of
  `CREATION_ATTESTED_MIGRATION_IDS`. A store created from empty on this release
  therefore carries a third attestation row in `sys_migration` at boot, in the
  same uniform shape as the two ADR-0104 rows (`details.attested:
  'datastore-created-empty'`, `applied_at: null`, `blocking: 0`, `verified_at`
  set for the fact observed at birth). Existing stores are untouched:
  `attestFreshDatastore` writes only on a store it observed being created and
  never overwrites a row, so a store created before this release attests
  nothing new — its row for this id arrives with the first run of the migration.
- **The ledger-claim matrix**, on the constant's docblock, replacing the
  registration-era "silence is not an answer": `last_run_at` on every completed
  non-`error` run (`migrated`, `already_done`, `not_applicable`); `applied_at`
  only on `migrated`; `verified_at` never set by a run (the migration has no
  self-check, and `verified_at` means one passed); `blocking: 0`;
  `details.outcome` carries the four-valued result; an `error` run writes no
  claim at all.
- **Receipt, not gate.** Nothing reads the row as a precondition, and nothing
  may: it is what an operator reads, in the shape the seed-tenancy repair
  already uses (`verified_at: null`, `blocking: 0`), which
  `isDataMigrationFlagVerified` answers `false` to by design.

Additive: no authorable key, export or accept-set narrows, so no BREAKING
banner applies. Which caller writes the run receipt when the migration runs is
the runner's own contract (`@objectstack/metadata/migrations`) and lands
separately.
