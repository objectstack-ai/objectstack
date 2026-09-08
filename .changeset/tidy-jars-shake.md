---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

Correct the out-of-package comments that still described `SqlDriver#formatOutput`'s
two timestamp passes as gated on `if (this.isSqlite)`.

Since ADR-0053 D-F1 (#13973) both passes — the `AUDIT_TIMESTAMP_COLUMNS` pass and the
`normalizeSqliteDatetimeOutput` pass over `datetimeFields` — run on every dialect, so a
declared `Field.datetime` and the builtin audit columns are presented as canonical
ISO-8601-`Z` text on Postgres and MySQL as well as SQLite. The `rest-server.ts` comment
went further than staleness: it warned future authors that "a declared `Field.datetime`
is therefore NOT protected on Postgres/MySQL", inviting exactly the tolerant consumer-side
coercion ADR-0053 forbids.

Comments only — no runtime behaviour, no exported symbol and no public type changes; the
published `.d.ts` of both packages is byte-identical. These two packages are named because
their bundled `dist/index.js` / `dist/index.cjs` carry the amended comment text verbatim,
so the published output does change. `@objectstack/metadata` carries the same correction
in `database-loader.ts` but is deliberately NOT named: its edits are all JSDoc blocks,
which its bundle strips, so its published output is unchanged.

Two carve-outs are preserved rather than flattened: `withPostgresCalendarDayAsText` is
untouched by that ruling (D-F2 — the client library still materialises `timestamptz` /
`DATETIME(3)` as a `Date`; the driver now folds it at its own read boundary), and the
Invalid `Date` residue still stands (D-F3 — the one `Date` shape with no canonical text
leaves the read door unchanged).
