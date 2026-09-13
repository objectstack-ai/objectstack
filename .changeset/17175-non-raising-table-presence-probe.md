---
'@objectstack/metadata-protocol': minor
---

The `kernel:ready` migrations ask whether a table exists WITHOUT running a statement that has to be refused, so a normal boot stops printing `[sql-driver] DATABASE_ERROR … no such table` (#17175)

Two migrations on the boot hook asked "does this table exist?" with a statement
that cannot succeed when the answer is no — `SELECT "tenant_id" FROM
"_objectstack_sequences" WHERE 1 = 0` in `seed-tenancy-backfill.ts`, and `SELECT
1 FROM sys_setting WHERE 1 = 0` in `sys-setting-identity-index.ts` — and read
the refusal as "no". Both are correct on their own terms. Both make
`SqlDriver.execute()`'s raw terminal write the statement and the dialect's
message to the operator's log on the way out.

Measured on this tree against real `better-sqlite3`: exactly one line per probe,
on `console.warn` — i.e. **stderr** — carrying both the `DATABASE_ERROR` token
and `no such table`. It fires on **every boot** of every install that has never
allocated an autonumber, and again on every boot of every kernel that does not
register the optional `service-settings`.

⭐ The cost is not the line. It is that operators learn this product prints
errors when nothing is wrong, and then miss the one that matters. A consumer told
to read the boot log (`objectstack-ai/hotclm`'s `AGENTS.md` names `no such table`
as a failing boot) must either ignore an unactionable ERROR every boot or chase a
platform-internal probe.

**The question is now asked of the CATALOG.** A new shared
`migrations/read-probe.ts` compiles one arm per dialect family — `sqlite_master`
for SQLite, `to_regclass` for Postgres, `information_schema.tables` scoped with
`DATABASE()` for MySQL — each of which returns zero rows for a table that is not
there instead of being refused. Both migrations call it; the probe lives once,
not once per site.

**⛔ Why not in the driver.** Quietening a refusal requires classifying it, this
repo has one predicate for that (`isMissingTableError`), and it needs the name of
the thing the caller was reading — which the raw path structurally does not have
(`rawStatementFaultError` declares no targeted table, and
`driver-error-classification.callers.test.ts` fails any in-repo call that omits
`readObject`). An unclassified demotion of the driver's raw terminal would
quieten real failures too. The caller knows the table; the driver does not.

**⛔ The fence, and it is the one way this repair can go wrong.** A catalog arm
mis-compiled for some dialect would be refused, caught by the same `catch` the
expected miss uses, and read as "the table is not there" — turning a stored-row
data repair into a silent no-op on whichever dialect nobody exercised. So the
probe answers four verdicts rather than a boolean, and `'unreadable'` is never
folded into `'absent'`: it is returned, and reported at `warn`. An unrecognised
dialect gets no guessed catalog statement at all — it keeps the caller's own
`WHERE 1 = 0` probe, whose refusal is now *classified* with
`isMissingTableError(error, table)` rather than swallowed as absence.

**Why `minor`.**

- `SeedTenancyBackfillStatus` gains `'unreadable'`. It is an OUTPUT union, so no
  input a caller writes is affected; the one consumer shape that could break is
  an exhaustive `switch` with a `never` default, which is why this is not a
  `patch`.
- `ensureSysSettingIdentityIndex` gains an optional third parameter
  (`{ client? }`). Callers that pass two arguments are unchanged and keep
  today's behaviour exactly — without a client there is no catalog arm and the
  pre-existing probe runs.
- `buildSequencesPresenceSql` and `buildSysSettingPresenceSql` are unchanged in
  text and still exported. They are no longer what the boot path runs first.
- `isResultSet` and `normalizeRows` moved to `migrations/read-probe.ts` and are
  re-exported from `seed-tenancy-backfill.ts` unchanged, so the package index and
  every importer see no difference.

**What did NOT change.** #10789's ruling stands: a seam that accepts a statement
and returns no result set still reports `absent` with the `detail` that separates
it. The driver's error channel is untouched — a statement the backend genuinely
refuses is still written to the log in full, asserted against the same driver and
the same sink in the same test as the silence.

**Dialect coverage, stated rather than implied.** The SQLite arm is pinned end to
end against a real `SqlDriver` (`packages/runtime`'s
`seed-tenancy-autonumber-split.integration.test.ts`); the MySQL arm runs against
the live server in `seed-tenancy-backfill.live-mysql.test.ts`, in both directions
and with the connected-schema scope measured. ⛔ The **Postgres** arm is NOT
MEASURED against a live server: this package has no live-PG harness, no `pg`
dependency, and its CI leg supplies `OS_TEST_MYSQL_URL` only while filtering to
`live-mysql`. Its statement text is pinned; running it is not.
