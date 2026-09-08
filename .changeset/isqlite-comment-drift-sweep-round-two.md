---
'@objectstack/cli': patch
---

Correct the remaining out-of-package comments that still described
`SqlDriver#formatOutput`'s two timestamp passes as gated on `if (this.isSqlite)`.

Since ADR-0053 D-F1 (#13973) both passes — the `AUDIT_TIMESTAMP_COLUMNS` pass and the
`normalizeSqliteDatetimeOutput` pass over `datetimeFields` — run on every dialect, so the
record read door presents the builtin audit columns and every declared `Field.datetime`
as canonical ISO-8601-`Z` text on Postgres and MySQL as well as SQLite. Measured on the
tree rather than recalled: in `packages/drivers/driver-sql/src/sql-driver.ts` the
`if (this.isSqlite)` arm inside `formatOutput` opens at line 16965 and closes at 17026,
covering only the JSON codec and the numeric-scalar repair, while the audit-column loop
(17046) and the `normalizeSqliteDatetimeOutput` loop (17061) both sit at the method's top
level, below that closing brace.

Two of the corrected comments were load-bearing rather than merely stale. The
`service-storage` one drew a conclusion for a live read door from the false premise, and
it also claimed that folding at the driver's read boundary "would reverse the deliberate
`withPostgresCalendarDayAsText` decision" — which is what #13973 ruled and did. The two
`packages/cli` ones attached the wrong reason to a true fact: the holder probe reads
through the raw-SQL seam, so `formatOutput` never runs on that path at all, and the
dialect divergence there survives the ruling for that reason and not because of a gate.

Comments only — no runtime behaviour, no exported symbol and no public type changes.
`@objectstack/cli` is the one package named here because its per-file build carries the
amended text verbatim into `dist/commands/migrate/duplicates.js` and
`dist/commands/migrate/duplicates.d.ts`, so its published output changes.
`@objectstack/metadata-protocol` is deliberately NOT named: its edits are all in test
files, which are not published. `@objectstack/service-storage` and `@objectstack/metadata`
are deliberately NOT named either: their source edits are JSDoc blocks on the internal
`usableCreatedAt` and `canonicalTimestampText`, and both bundles strip them — measured
absent from `dist/`, with each package's identifier found in the same `dist/` (and the
exported `StrandedOrphanInventoryEngine` docblock present in `dist/index.d.ts`) as the
firing control that the probe works.

Three carve-outs are preserved rather than flattened: `withPostgresCalendarDayAsText` is
untouched by that ruling (D-F2 — the client library still materialises `timestamptz` /
`DATETIME(3)` as a `Date`); the Invalid `Date` residue still stands (D-F3 — the one `Date`
shape with no canonical text leaves the read door unchanged, so no sentence claims the
read door never hands out a `Date`); and the ruled-B consumer arms stay, with only the
prose explaining why they exist corrected.
