---
"@objectstack/driver-sql": minor
"@objectstack/objectql": minor
"@objectstack/platform-objects": minor
"@objectstack/spec": minor
"@objectstack/cli": minor
---

feat(driver-sql,objectql,cli)!: the ADR-0104 file-family column step, and the kernel→driver supply that arms it (#15989)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves. No `packages/spec` key, no Zod schema, no authored metadata property, no object definition and no accepted request shape changes its spelling, type or legality in this diff: `DataMigrationFlagSchema` and its `columns_moved_at` member landed under #16185 and are READ here, not edited, and the one `packages/spec` edit is a new exported PREDICATE function over that existing type. So `objectstack migrate meta` has nothing to visit, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain — the ledger's whole subject is authored metadata, and what moves here is a physical column's type plus the encoding of the values inside it, on a deployment whose operator ran a command to move them. ADR-0104's row-data side already has its own declared, operator-run surface (`os migrate files-to-references`), which is not a metadata upgrade. The other four categories are closed on facts: every package here publishes to npm, declares no `private` and ships `dist` in `files[]` (not `unpublished`); no ADR-0087 id is minted in this diff (not `registered`) and none pre-dates the base that would cover it (not `already-registered`); and exported declarations DO change — five new exports and two new public methods — so neither `runtime-interface-only` nor `type-surface-only` applies. The `**BREAKING**` banner below is carried rather than dropped, because published storage behaviour of `@objectstack/driver-sql` changes. -->

**BREAKING** on the published storage behaviour of `@objectstack/driver-sql`. A deployment that runs `os migrate files-to-references --apply` now has its media columns **retyped and their values rewritten** into the bare-`sys_file`-id encoding, and its driver writes bare ids from the next boot. This completes the maintainer ruling on #15041 (「15041 应该改为实际 id 保存。选A，其他同意」) whose encoding half shipped in the previous release.

Shipped as `minor` under the repo's launch-window convention, in which `major` is refused by `check-changeset-no-major` and breaking-ness is carried by this banner plus the ADR-0087 disposition rather than by the level.

## The column step

`os migrate files-to-references --apply` gains a further step, run **only after** the backfill and its self-check report zero blocking rows — and it moves nothing at all until three gates pass:

1. the migration's own gate (zero blocking rows);
2. **every** abort pre-check, across **every** planned column, before a single statement runs;
3. no refusals — a column the driver could not plan stops the columns it could.

**PostgreSQL** and **SQLite** only. ⛔ MySQL is refused by name and belongs to #17788, where its statement ORDER is settled against a real instance rather than transcribed.

Per column, the shape is read off the column's **physical type**, not off the dialect: a `json` column is retyped (`ALTER … TYPE varchar(2048) USING (col #>> '{}')`), while a column that is already `varchar` — the population `os generate migration --format sql` creates and a JSON-arm driver fills with quoted ids — has its values unquoted in place. SQLite has only the second shape, since it has no json type.

### ⛔ The abort clause is NOT the one the ADR sketched

The #15041 addendum prescribed the retype with nothing in front of it while *requiring* the step to abort "on the first cell that is not a JSON string". Those two sentences contradict each other, and which was wrong was settled by running it. Measured on live PostgreSQL 16.13, `USING (col #>> '{}')` is **accepted** over a row holding an inline metadata blob, because `#>> '{}'` extracts *any* json type as text: the bytes survive, but the column is no longer `json`, so an object becomes a plain string in a column whose declared contents are ids — silently, in a migration that reports success. The director ruling (decision batch #120 item 1) replaced the clause with the pre-check that implements the requirement: `json_typeof(col) IS DISTINCT FROM 'string'` on PostgreSQL, and `json_valid(col) AND json_type(col) <> 'text'` on SQLite, where excluding invalid JSON is what keeps a re-run idempotent over cells a previous run already moved.

Both the destructive form and the guarded one are executed side by side, on one fixture, in this release's own test suite — so the difference stays a measurement rather than a comment.

## The kernel→driver supply seam

`SqlDriverConfig.fileColumnsMoved` shipped last release and no host outside the driver supplied it. It is supplied now: `ObjectQL.registerDriver` hands every driver that has the seam a closure over the new `ObjectQL.haveFileColumnsMoved()`, which reads `sys_migration.columns_moved_at` — and requires the `adr-0104-file-references` flag to be verified **as well**, since the stamp alone would attest a column move with nothing attesting the values inside it.

⭐ **Every way of not knowing still answers "not moved".** The option omitted, a resolver that throws or rejects or answers a non-`true` value, a resolver that never runs because the host never calls `initObjects`, a driver with no such seam, no `sys_migration` object, no row, an unreadable table, a null or empty stamp — all the JSON arm. That is the encoding every deployment in the world is on, and a driver that guessed the other way would write bare ids into a JSON column.

⛔ **A host that names `fileColumnsMoved` in its own config wins**, in either polarity. The engine only ever fills an empty slot, and never contradicts an explicit composition: overruling a declared `false` is precisely the bare-ids-into-a-JSON-column failure this mechanism exists to prevent.

## New published surface

- `@objectstack/spec` — `hasMovedFileColumns(flag)`, the single arbiter of the conjunction above, beside `isDataMigrationFlagVerified` and `authorisesIrreversibleAction`.
- `@objectstack/objectql` — `ObjectQL.haveFileColumnsMoved()`, sharing one memoized read (and one `invalidateDataMigrationFlags()`) with `isFileReferencesMigrationVerified()`, so the two answers can never come out of one another's date.
- `@objectstack/platform-objects` — `recordFileColumnMove(engine, migrationId)`, which refuses to stamp a deployment with no verified flag row. `readDataMigrationFlag` now carries `columns_moved_at`; it previously dropped it, which made a moved deployment indistinguishable from an unmoved one to every caller.
- `@objectstack/driver-sql` — `SqlDriver.setFileColumnsMovedResolver()`, `SqlDriver.planMediaColumnMove()`, and the statement builders `mediaColumnMovePlan` / `mediaColumnMoveDialect` / `isJsonColumnType` with `MEDIA_COLUMN_MOVE_DIALECTS`, `MEDIA_COLUMN_MOVE_ROLLBACK_NOTES` and `MEDIA_ID_MOVE_WIDTH`. The statements live in the package that owns the dialects and measured them; a second copy in the CLI would be a second copy of the clause the ruling got wrong.

## What does NOT change

A deployment that does not run `--apply` is byte-for-byte where it was: the column stays `json`, the write still JSON-encodes, and the read still accepts both encodings. A backfill re-run does not set the stamp and — deliberately — cannot clear it either: `recordDataMigrationRun` omits the key rather than writing a preserved value, so a ledger read that FAILS cannot demote a moved deployment back onto the JSON arm. A partial or failed column step records nothing at all, which leaves such a datastore on the arm that reads both encodings.

`multiple: true` media is untouched on both arms: its value is a list of ids and a JSON column on every deployment.
