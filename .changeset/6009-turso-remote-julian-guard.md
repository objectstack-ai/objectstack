---
'@objectstack/driver-turso': minor
---

`driver-turso`: the REMOTE canonical temporal backfill no longer overwrites a bare-number cell with the date SQLite reads it as (#6009).

`RemoteTransport.mapFieldTypeToSQL` declares every temporal column `TEXT`, so a `Field.datetime` / `Field.time` column can hold a digits-only string such as `'2026'`, `'86400'` or the keyword `'now'`. SQLite's time-value grammar accepts a bare number as a JULIAN DAY and `now` as the wall clock, so for those two shapes `strftime` answers confidently instead of returning NULL and the `coalesce(strftime(…), col)` that is supposed to preserve unparseable values never fires. The convergence `UPDATE` in `backfillRemoteCanonicalColumn` therefore wrote that answer over the stored bytes, and no later run could get them back — measured on better-sqlite3 13.0.3 / SQLite 3.53.4 with the column declared `TEXT`:

```text
'2026'  -> -4707-06-11T12:00:00.000Z    'now' -> the wall clock, now
'86400' -> -4476-06-15T12:00:00.000Z    '12'  -> -4713-12-06T12:00:00.000Z
```

The local (Knex) half of this was fixed for `SqlDriver` in the same tracker; the remote path is a separate module that builds its own statements and did not inherit it.

- **The rows are withheld from the `UPDATE` and they also BLOCK the canonical mark.** Withholding alone would not be enough: a marked column drops the read-side repair, and the raw `'2026'` would then compare as TEXT instead of as the instant the repair reads it as. A withheld row is by construction `col IS NOT canonical`, so it stays inside the probe's `residual`, which the mark already requires to be zero. The column keeps its (unindexed) repair and every query answer is bit-for-bit what it was.
- **The predicate is the driver's own, handed across the module boundary — never copied.** `TursoDriver` now passes `{ canonical, nonTemporalText }` where it passed a bare canonical expression, the second arm being `SqlDriver.sqliteNonTemporalTextSql`. Nothing in the shared READ expression changes: `sqliteCanonicalDatetimeSql` / `sqliteCanonicalTimeSql` still misread a bare number exactly as before, deliberately, per the 2026-08-03 cloud#1005 ruling that refused a heuristic in a public expression that runs on every read.
- **The third position of `probeRemoteCanonicalColumns`, `backfillRemoteCanonicalColumn` and `backfillRemoteCanonicalColumns` now accepts either shape**, so a caller compiled against the earlier release keeps compiling: `RemoteBackfillSqlRules` (`{ canonical, nonTemporalText }`) is the shape to pass, and a bare `CanonicalSqlFor` is FAIL-CLOSED rather than a fallback — with no guard to withhold by, the convergence phase is refused, the column reports `error` and stays unmarked, and reads stay correct on the repair. The 后果 B epoch recovery still runs on that arm. To move off it: pass `{ canonical: <what you passed before>, nonTemporalText: <the driver's sqliteNonTemporalTextSql> }`.
- **New on the per-column report: `nonTemporalTextRowsWithheld`** — what the guard declined to write, or `null` when no guard was supplied and the count was therefore never measured. It is deliberately NOT folded into `unresolvedEpochTextRows`, whose documented meaning is *recorded and harmless to the mark*; these rows are the opposite.
- **A documented sentence is corrected in the same change.** The module said rows outside the epoch-recovery band "do not block the canonical mark, because they are fixpoints of the shared repair". That is true only ABOVE SQLite's julian-day ceiling, where `strftime` returns NULL. Below it — `'12'`, `'2026'`, `'86400'` — the repair answers, the row is not a fixpoint, and dropping the repair changes what it matches. Both halves are now stated with the measurement behind them.
- **The two bands do not meet, so the guard costs the epoch recovery nothing.** A bare number is read as a julian day only for `0 <= v < 5373484.5` (`'5373484.4'` parses, `'5373484.5'` returns NULL); `REMOTE_BACKFILL_EPOCH_MS_MIN` is `1e12`. The epoch-text `UPDATE` is also structurally out of reach for a second, independent reason: its SET wraps `cast(col as real)`, whose `typeof()` is always `'real'`, so the canonical expression takes its `'unixepoch'` limb and never the `coalesce`/julian one.

No read path, no filter compilation and no stored value changes for any column that holds none of this shape: a table with nothing but ordinary legacy rows converges and is marked exactly as before.
