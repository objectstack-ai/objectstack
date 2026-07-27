---
"@objectstack/spec": minor
"@objectstack/platform-objects": minor
"@objectstack/service-storage": minor
"@objectstack/objectql": minor
"@objectstack/cli": minor
---

feat(migrate): `os migrate files-to-references` — a data migration with a self-check, gated per deployment (#3617)

The ADR-0104 file-as-reference migration ships as a command a deployment runs
against its own database, and the deployment-level flag it records is what may
later authorise irreversible behaviour — never the platform version.

```bash
os migrate files-to-references           # dry run: reports, writes nothing
os migrate files-to-references --apply   # converts, verifies, records the flag
```

The run backfills legacy file-field values (inline metadata blobs, own-resolver
URLs, `data:` URIs) into owned `sys_file` references, reconciles the ownership
ledger against what records actually hold, and — only on an `--apply` run whose
reconciliation reports **zero blocking discrepancies** — records
`sys_migration { id: 'adr-0104-file-references', verified_at, blocking: 0 }`.

**Why a flag rather than a release note.** ObjectStack is a development
platform: third-party deployments upgrade on their own schedule and their data
is not observable by anyone else, so no release-side soak can vouch for them.
The evidence has to be produced where the data is. Consequences:

- Installing a new version never starts deleting bytes. Running the migration
  and passing its self-check is the consent.
- Not run, or not passed → files are retained forever. Wasted storage, zero
  data loss.
- A later failing run **clears** `verified_at`: a deployment whose data has
  drifted closes its own gate.
- A dry run writes nothing at all — not the conversions, and not the flag,
  even when the self-check would pass.
- External URLs stay advisory. They are not `sys_file`s, so they can never
  enter collection; whether to remodel them as a `url` field is the app
  author's decision (ADR-0104 R7), not a gate.

Ships alongside:

- `@objectstack/spec` — `DataMigrationFlagSchema`, `FILE_REFERENCES_MIGRATION_ID`,
  and the single `isDataMigrationFlagVerified` predicate both future consumers
  (collection #3459, strict value-shape #3438) read, so the two gates cannot
  disagree about the same fact.
- `@objectstack/platform-objects` — the `sys_migration` object plus
  `readDataMigrationFlag` / `isDataMigrationVerified` / `recordDataMigrationRun`.
  Reads fail toward "not verified": a gate that cannot read its evidence stays
  closed.
- `@objectstack/objectql` — a read may now opt out of file-reference expansion
  via the spec's `RAW_FILE_VALUES_CONTEXT_KEY`, and the storage service's
  bookkeeping/scan reads do. Without it the read resolver rewrites stored ids to
  their expanded form before the reconciliation sees them, which reports held
  references as absent — noisy `stale_owner` findings, and a missed
  `unowned_reference` would have been a false pass of the collection gate.
