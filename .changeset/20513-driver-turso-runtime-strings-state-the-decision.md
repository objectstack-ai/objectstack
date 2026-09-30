---
'@objectstack/driver-turso': patch
'@objectstack/driver-sql': patch
---

driver-turso refusals and log lines, and driver-sql's last three aggregate refusals, no longer cite tracker numbers; each states the reason in words

Clause-②: no

Many messages the Turso driver shows to authors and operators ended with an issue-tracker number where
the reason belonged. Most of the Turso remote transport's numbers were bare ids from the repository that
file used to live in, so here they pointed at unrelated cards. The number goes, and where the sentence
did not already say what was decided, it now does:

- Aggregate refusals, on both drivers: the undeclared-function, `count_distinct`-without-`field` and
  per-aggregation `filter` refusals lose their citation on the SQL driver and the Turso remote
  transport together, so the two faces still read one sentence. The remote transport's
  declared-but-uncompiled and date-bucket refusals lose theirs too, and read exactly like the SQL
  driver's again.
- Turso remote filter refusals (`INVALID_FILTER`): the withheld cross-field and unbindable-comparand
  wording, and the full diagnostics behind every filter refusal (unsupported operator, unlowered
  `$between`, undeclared or non-list combinator, non-node operand, non-object `where`, empty operator
  map, undefined comparand, non-boolean `$exists`) lose only the citation, because their sentences
  already said it. The non-boolean `$null` diagnostic now says every driver refuses it, so one filter
  no longer gets a different answer per backend.
- The Turso remote `auto_number` refusal (`NOT_IMPLEMENTED`) now says why it refuses rather than
  resolves: resolving would write NULL into the slot and persist the row without its record number.
- Log lines: the unnumbered-upsert warning loses its citation; the remote canonical backfill's info line
  says what a conversion buys (the column drops the unindexable read-side repair only once a pass finds
  nothing left to convert); the unresolvable-remainder warning says a value that cannot be read as an
  instant is counted and reported, never guessed at.

Text only: no error code, field name, status or behaviour changes.
