---
"@objectstack/service-storage": patch
---

fix(service-storage): report `createdAt` on every stranded-orphan sample, not only on SQLite (#13996)

`inventoryStrandedFileOrphans` projects `created_at` out of the `sys_file` read
door and then tested it with `typeof row.created_at === 'string'`. `created_at`
is a BUILTIN audit column — it is not in `datetimeFields`, and
`SqlDriver#formatOutput` repairs the audit columns only inside its
`if (this.isSqlite)` arm — so that door hands the value back as canonical ISO-Z
text on SQLite and as a JS `Date` on Postgres and MySQL, the production default
drivers (pinned per dialect in driver-sql's
`sql-driver-13567-audit-stamp-materialisation.test.ts`).

The guard was therefore `false` for **every** row on both live dialects: a field
explicitly asked for from the driver was silently discarded, and every sample in
an operator's stranded-orphan report carried `createdAt: undefined` there while
looking correct on the SQLite the suite runs on.

The consumer now accepts both shapes and reports the canonical ISO-Z spelling —
the repair `@objectstack/metadata-protocol` already carries for `occurred_at`.
Normalising at the driver's read door instead would reverse the deliberate
`withPostgresCalendarDayAsText` decision that a `timestamptz` is an instant, so
the consumer owes the spelling.

No exported shape changes: `StrandedOrphanSample.createdAt` stays
`string | undefined`. An ISO string is still passed through byte-for-byte, and
an absent, null or unparseable stamp still reports `undefined` — never the
literal `"Invalid Date"` or `"undefined"` in the position an operator reads a
timestamp from. The sibling `key` / `name` guards are untouched: those are text
columns on every dialect, and only the timestamp straddles the divergence.
