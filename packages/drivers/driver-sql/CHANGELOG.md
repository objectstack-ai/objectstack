# @objectstack/driver-sql

## 17.4.0

### Minor Changes

- 54bb2f1: The analytics SQL compilers compile the case-sensitive text family per dialect, so a `$contains` policy on SQLite stops admitting rows it excludes (#15684)
  
  `$contains` / `$notContains` / `$startsWith` / `$endsWith` are case-SENSITIVE on every backend (#4706 Q2 = A). All three of `service-analytics`' SQL compilers emitted `col LIKE ? ESCAPE ?` on every dialect, and SQLite's `LIKE` folds ASCII case unconditionally — the fold cannot be turned off per statement, because `PRAGMA case_sensitive_like` is a connection-global switch. Measured on sql.js over the shared `FILTER_TEXT_ROWS` fixture, `{ name: { $contains: 'acme' } }` answered `['1','2']` — `ACME Corp` **and** `acme corp` — where `FILTER_TEXT_CASES` says `['2']`.
  
  On two of the three compilers that is a wrong chart. The third is `read-scope-sql.ts`, the ADR-0021 D-C read scope: a scope that **admits** rows the policy's case-sensitive predicate excludes is over-reach, not a loose filter — the same reading that file already applied to its own `LIKE` escaping. The `/analytics/sql` echo was wrong in a third way: it printed `LIKE` while the statement it claims to reproduce ran through a driver that has emitted `GLOB` on the SQLite dialects since #6518.
  
  What changed:
  
  - **The construct is chosen per dialect** (`text-match-sql.ts`), arm for arm with `driver-sql`'s own table: `GLOB` on SQLite (case-exact by definition, with its own `*` / `?` / `[` escaped class and no `ESCAPE` clause), `LIKE` over `CAST(… AS BINARY)` on MySQL, and `LIKE` **unchanged** on Postgres, where it is already exactly the ruled semantics. There is no single construct that is case-exact and parses on all three, so the dialect had to become an input rather than a guess.
  - **The dialect arrives from the driver that will execute the statement.** New optional `AnalyticsServiceConfig.sqlDialect`, wired by `AnalyticsServicePlugin` from `IDataEngine.getDriverForObject`. `SqlDriver.dialectName` is now public so that answer can be read without a second dialect-resolution table drifting behind the driver's own knex spellings; it is derived and read-only.
  - **A host that answers no dialect keeps the `LIKE` it always got** — "cannot answer, do not block". Postgres deployments see byte-identical SQL.
  
  `$icontains` is untouched: it keeps its own ASCII-only fold on both sides, and collapsing the two families onto one path would hand the case-exact family back the fold the ruling took away from it. `LIKE` escaping is unchanged wherever a `LIKE` is still emitted.
- a646120: A text operator over a column whose declared type stores no text (`Field.number` and its numeric siblings, `Field.boolean`) now compiles to the contract's declared answer on every dialect, instead of a dialect accident.
  
  Before: `{ score: { $contains: '5' } }` over a numeric column compiled `col GLOB '*5*'` on SQLite and coerced the REAL in its storage class's spelling (`5` as `'5.0'`, so `$endsWith: '0'` matched every row), `col LIKE $1 ESCAPE $2` on Postgres and was refused at query time with SQLSTATE 42883 (`operator does not exist: real ~~ text` — a 500 for a filter the spec accepts), and `CAST(col AS BINARY) LIKE ?` on MySQL.
  
  Now (`FILTER_TEXT_CASES`' `score` rows, maintainer ruling 2026-09-05): the positive operators (`$contains` / `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike`) compile to `1 = 0` and `$notContains` to `1 = 1` — the same row set as every JS face, decided from the declared type at compile time because the stored value is not visible until run time. Postgres: a 500 becomes a result. The gate reads the `numericFields` / `booleanFields` registries `initObjects` and `registerExternalObject` already fill; a table this driver was never told about keeps the `LIKE` / `GLOB` it always compiled, every comparand refusal still runs first, and the constants compose with the NULL-safe rules (`$notContains` admits a NULL row already) and the `$not` rewrite. Temporal columns are untouched: their stored value IS text on SQLite, so the contract declares nothing for them.
  
  `driver-sqlite-wasm` and `driver-turso`'s local transport inherit this compiler.
- 2200f8e: feat(driver-sql): `update()` publishes its honest type — the contract's `Record<string, unknown> | null`, not `any` (#14438)
  
  **BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (the one PR #14434 used for the same door on `@objectstack/driver-memory`). `SqlDriver.update()` was written out with an explicit `Promise<any>` while it has always answered a missing id with `null` (`formatOutput(...) || null` on the un-rotated path, `null` once every rotation shard has been probed). `IDataDriver.update()` declares `Promise<Record<string, unknown> | null>`, and an explicit `any` satisfies that structurally — so the emitted `.d.ts` read `Promise<any>` and no caller holding a `SqlDriver`, or a `SqliteWasmDriver` (which inherits the door unchanged), was ever asked to narrow. It is now declared as the contract declares it, and the protected rotation-path producer `rotatedUpdateById()` carries the same type. A caller that read fields off `update()`'s result through the `any` now narrows the `null` arm first; a caller that leaned on `any` to read undeclared members now types them. No runtime behaviour changes.
  
  `@objectstack/driver-sqlite-wasm` re-declares no `update` member of its own (measured on its emitted `.d.ts`), so it carries no entry: the narrowing reaches its consumers through this package's `.d.ts`. `@objectstack/driver-turso` overrides the door and carries its own entry.
  
  <!-- adr-0087: not-required (type-surface-only packages/drivers/driver-sql/src/sql-driver.ts#update) A published driver method's declared return moves off an explicit `any` onto the contract's own shape. No metadata key is removed, renamed or re-shaped, `packages/spec` is untouched, and nothing exists for `objectstack migrate meta`, `spec-changes.json` or the upgrade guide to rewrite; the obligation is a TypeScript narrowing at the consumer's own call site, delivered by the compiler. -->

### Patch Changes

- 61821e5: A plain unique index over existing duplicate rows no longer kills the boot with the database's raw error, and `os migrate plan` no longer calls that op `safe`.
  
  Declaring a column unique over a table that already holds duplicates had two very different outcomes depending on one branch in the SQL driver, and only one of them was survivable.
  
  - **An organization-scoped unique** (the `unique: 'organization'` default, materialised as the NULL-safe `COALESCE(organization_id, '__global__')` composite) kept the boot up: the driver logged at `error` naming the index, the constraint that is not enforced and the remedy, and the ADR-0120 D4 duplicate pre-flight reported the blocked `create_index` as `category: 'destructive'` / `severity: 'error'` with the conflicting key groups and their row counts.
  - **A plain unique** — no organization key part at all, reached by an object with `tenancy: { enabled: false }` or by any explicit `unique: 'global'` — took the process down: `initObjects` threw the database's own error, which names the index and the column and no rows and no remedy, nothing reached the durability channel, and `detectManagedDrift` (what `os migrate plan` reports) classified the very same op `category: 'safe'`, `severity: 'warning'`, so `os migrate apply` and dev `autoMigrate: 'safe'` walked straight into the raw failure.
  
  The plain path now reaches the same posture as the scoped one:
  
  - **The boot survives and says what is not enforced.** `syncDeclaredIndexes` absorbs a uniqueness violation on a plain unique index the way it already absorbed one on the NULL-safe composite: the failure is logged on the durability channel (`error`) naming the index, the conflicting key groups with their row counts, the constraint that is NOT enforced, and `os migrate plan` as the way out. A non-unique index and any failure that is not a uniqueness violation still surface as before.
  - **The duplicate pre-flight covers it.** The ADR-0120 D4 probe no longer skips ops whose NULL-safe column set is empty, so a plain unique `create_index` over dirty data is reported `destructive` / `error` with the same row report instead of `safe`. Nothing new probes it: the existing probe already groups by the bare columns when there is no NULL-safe key part, so both key shapes share one pre-flight rather than a second copy that can drift from the first.
  
  Consumers of the classification see the op move from the "Safe" group to "Destructive (requires --allow-destructive)" in `os migrate plan` and `os diff`; `os migrate apply` defers it instead of attempting it; the artifact boot gate refuses with a named destructive-drift refusal instead of crashing; and dev `autoMigrate: 'safe'` leaves it alone. Clean data is unaffected — the probe finds nothing and the index is created exactly as before.
- Updated dependencies [2ed6be6]
- Updated dependencies [ceb4877]
- Updated dependencies [ca326b5]
- Updated dependencies [8f404a5]
- Updated dependencies [3e3ecb0]
- Updated dependencies [b548e43]
- Updated dependencies [13c48c2]
- Updated dependencies [6f94458]
- Updated dependencies [6e67b86]
- Updated dependencies [132742f]
- Updated dependencies [85a2459]
- Updated dependencies [e89fa92]
- Updated dependencies [56fe8c2]
- Updated dependencies [ef3a138]
- Updated dependencies [fa125f3]
- Updated dependencies [a646120]
- Updated dependencies [6f1ce7d]
- Updated dependencies [2c753fe]
- Updated dependencies [52804cd]
- Updated dependencies [3f89967]
- Updated dependencies [088f761]
- Updated dependencies [a84e1ce]
- Updated dependencies [bf1054a]
- Updated dependencies [d8d2776]
- Updated dependencies [222dc0f]
- Updated dependencies [f9a3c32]
- Updated dependencies [f502898]
- Updated dependencies [5eb24f8]
- Updated dependencies [cc00df2]
- Updated dependencies [cc00df2]
- Updated dependencies [414c1fc]
- Updated dependencies [0db2947]
- Updated dependencies [d4f9b2a]
- Updated dependencies [5f7fa1d]
- Updated dependencies [87f0ccc]
- Updated dependencies [aedbaef]
- Updated dependencies [a727043]
- Updated dependencies [46803fa]
- Updated dependencies [c2a336c]
- Updated dependencies [f7db8f4]
- Updated dependencies [9408b7f]
- Updated dependencies [b398ad2]
- Updated dependencies [3d3f60e]
- Updated dependencies [581d8f8]
- Updated dependencies [40a44b9]
  - @objectstack/core@17.4.0
  - @objectstack/spec@17.4.0
  - @objectstack/types@17.4.0
  - @objectstack/observability@17.4.0

## 17.3.0

### Minor Changes

- 0010797: Cross-schema foreign keys are now qualified instead of shipping an unusable bare name (#11377).
  
  `IntrospectedForeignKey` (driver-sql) gains an optional `referencedSchema`, present when — and
  only when — the referenced parent table lives outside the introspecting session's resolution
  scope (Postgres: the parent's schema is not on `current_schemas(false)`; MySQL: the parent's
  database differs from `DATABASE()`; SQLite never sets it — no schemas, and a foreign key cannot
  cross an ATTACHed database). `referencedTable` stays a bare name always — the qualification is a
  separate key, never a conditional spelling.
  
  `convertIntrospectedSchemaToObjects` (objectql) reads the new key: a foreign key whose target
  carries `referencedSchema` is loudly skipped and flagged through the new `options.logger`
  (default `console`) instead of being wired to the bare name — which either resolved to nothing
  or to a same-named table in the current schema, silently. The column is kept as a plain field so
  its data stays visible. Foreign keys with in-scope targets keep producing identical lookup
  fields.
- 09f9361: Report a multi-value field left on a stale `varchar`/`text` column, instead of
  letting it silently corrupt every array written to it
  
  A field that gains `multiple: true` materialises as a `json` column on a fresh
  database, but `initObjects` is additive-only: on a database created while the
  field was single-value, nothing is missing, so nothing is added and the old
  `varchar`/`text` column is kept forever. The write path stringifies the array
  for a json field on every non-SQLite dialect; the read path relies on the
  driver's column-type-based decoding, which a stale textual column defeats. The
  array goes in as the literal `["id1","id2"]` and comes back as a **string** —
  so a hook copying the value into a child record's single-lookup column writes
  that whole string as one id. User-filed production report, repaired by hand on a
  live database.
  
  Until now the schema-drift detector said **nothing** about it. Measured on the
  pre-fix tree against live Postgres 16.13 and MySQL 8.0.46: after the metadata
  change and a reboot, `detectManagedDrift()` returned `[]` and the boot logged
  zero `[schema-drift]` lines, while the very next write stored
  `["user_A","user_B"]` into a `character varying(255)` column and read it back
  with `typeof === 'string'`. The action vocabulary had no "the base type is
  wrong" entry at all — only `relax`/`tighten_not_null`, `widen`/`narrow_varchar`,
  `drop_column`, `drop_column_default` and the index ops.
  
  The divergence is now **detected and reported**, naming the table, the column,
  the declared type, the physical type and the exact statement an operator runs by
  hand — dialect-correct, and executed against both live servers by the suite
  rather than merely printed. ObjectStack does **not** change the column: an
  `ALTER TABLE … TYPE json USING …` over existing rows with an index drop and
  rebuild is a destructive migration over shipped data, and whether the platform
  should perform it is a separate, open decision. The new `manual_column_type_change`
  op deliberately has no reconciler arm; `applyMigrationEntries` reports it as
  skipped, which is the intended contract while that decision is open.
  
  Reported at severity `error` and category **`needs_confirm`**, and the category
  is load-bearing rather than cosmetic. Every database this finding describes is
  already serving — that is the premise of the report — and the artifact-pinned
  boot gate refuses a boot for `category === 'destructive'` and nothing else
  (`severity` it never reads). Measured both ways: a `destructive` entry returns
  `ok=false` from that gate, this entry returns `ok=true`. Spelling it
  `destructive` would have turned every affected deployment into a crash-loop on
  its next restart — the report of the corruption becoming the outage.
  
  SQLite is deliberately excluded, and the exclusion is a measurement rather than a
  scoping convenience: the same stale column reads back as a real `['x','y']`
  array there, because SQLite's read path `JSON.parse`s regardless of what the
  column calls itself. There is no corruption to report, and reporting it anyway
  would put a permanent `error` finding on every long-lived SQLite development
  database. A stale `integer`/`timestamp` column is excluded for the mirror-image
  reason — the server already refuses that write loudly, so there is no silence to
  break.
  
  Also fixed, same defect class: a multi-value field that *also* declared
  `maxLength` used to produce `narrow_varchar` at severity `error`, category
  **destructive** on both enforcing dialects — a finding that refuses the
  artifact-pinned boot and invites `os migrate apply --allow-destructive` to
  rewrite the column to `varchar(50)`, the exact opposite of the repair it needs.
  `createColumn` returns at its `multiple` branch before `maxLength` is ever read,
  so the emitter never asks for that width; the differ no longer does either. The
  single-value width branch is untouched and pinned as untouched.
- 34d3011: Report an **unbounded** text-family field left on a pre-existing `varchar`
  column, instead of leaving the operator with a refused write and no diagnostic
  
  After #11875/#12119 a **newly created** `signature` / `qrcode` column is TEXT and
  holds a data URI correctly. `initObjects` is additive-only, so on a database
  created by an earlier release nothing is missing, nothing is added, and the old
  `varchar(255)` column is kept forever — the boundary #12119's own changeset
  states in as many words. What was not stated is what the drift reporter did
  about it, and the answer was **nothing**.
  
  The varchar differ's entire branch required `declaredMaxLength !== undefined`, so
  on a pre-existing table it split the text family by whether its author had
  written a number:
  
  ```
  Field.signature({ maxLength: 4096 })  over varchar(255)  ->  widen_varchar   reported
  Field.signature()      — no bound     over varchar(255)  ->  (nothing)       silent
  ```
  
  The second row is the common case. Measured on the pre-fix tree, one
  `diffManagedTable` call per type on dialect `postgres` against a `varchar(255)`
  column: `text` / `textarea` / `html` / `markdown` / `richtext` / `code` /
  `signature` / `qrcode` with no `maxLength` each returned **zero** entries, while
  `{ type: 'signature', maxLength: 4096 }` over the same column returned exactly
  one `widen_varchar` in the same run — so the differ was working and this shape
  was simply invisible to it. An upgrading deployment therefore saw no change and
  no diagnostic, while the server kept refusing the same write; and the refusal is
  a poor substitute for a report, because the live probe behind objectql's
  `driver-fault-redaction.ts` measured Postgres's `22001` as identifier-only and
  naming the **type** rather than the column (`value too long for type character
  varying(255)`).
  
  The divergence is now **detected and reported** under a new report-only
  `manual_widen_varchar_to_text` op, naming the declared type, the physical width,
  the consequence, and both operator routes. Same `declared ≠ enforced` shape as
  the #11374 / #11431 / #11875 family, closed one door further along — at the
  migration seam rather than the authoring or write seam.
  
  **Nothing is migrated for you, and nothing new is refused.** There is no
  reconciler arm: `os migrate apply` reports the entry as skipped, exactly as it
  does for `manual_column_type_change`. The entry is `category: 'needs_confirm'`,
  so the artifact-pinned boot gate — which refuses a boot for `destructive` and
  nothing else — is unaffected: a deployment that merely refuses over-long values
  must not become a crash-loop on its next restart. Dev auto-reconcile takes
  `safe` only, so it never applies this unattended either. SQLite is excluded: it
  enforces no declared width, so there is no divergence to report.
  
  `manual_widen_varchar_to_text` is a **distinct** op rather than a second use of
  `manual_column_type_change`, for a measured reason: `os migrate
  multi-value-columns` selects its entire population by
  `op.type === 'manual_column_type_change'` and recovers the dialect by matching
  the message against `manualJsonConversionSql`, so sharing the op would hand this
  finding to a command whose remedy makes the column `json` — and, the message
  carrying no json statement, have it refused as `remedy_not_recognized` on every
  run.
  
  Graded `minor` rather than `patch` on two counts, matching the sibling drift-op
  addition that shipped for #11535: `detectManagedDrift` emits a finding on
  existing deployments where it previously emitted none (visible in `os migrate
  plan`, in `os migrate apply`'s skipped count and in the boot-time
  `[schema-drift]` warn), and the exported `DriftOp` union gains a member, which is
  additive for producers but widens a type any consumer switching exhaustively
  over it must account for. Nothing is removed, renamed or newly rejected, so it is
  not a breaking change.
- d0e3a88: **Fix:** a text-family field that a declared index keys on is emitted as `varchar(maxLength)` instead of an unbounded `TEXT`, so the index MySQL previously refused can actually be created (#11374).
  
  `createColumn` mapped the whole text family (`text` / `textarea` / `html` / `markdown`) to an unbounded `TEXT`, ignoring the field's own declared `maxLength`. MySQL refuses a `TEXT`/`BLOB` column in a key without a prefix length, and the two halves of schema-sync fail *separately*: the `CREATE TABLE` succeeds, then `ALTER TABLE … ADD [UNIQUE] INDEX` fails with `ER_BLOB_KEY_WITHOUT_LENGTH`. The table therefore lands on disk **without the constraint it declared**, and the object stays registered-but-broken. Measured on a live MySQL 8.0.46: **36 of the 44 platform objects** failed schema-sync this way, so a stack whose `default` datasource is MySQL could not stand up its own schema — the dev-admin seed never landed and first sign-in returned `401 INVALID_EMAIL_OR_PASSWORD`. Honouring the declared bound takes that to **12**.
  
  **The bound is the field's own `maxLength` — nothing is invented.** `schema-drift.ts` already treated `varchar(field.maxLength)` as the expected physical shape of a bounded field (its `widen_varchar` / `narrow_varchar` ops say so in as many words); this is the emitter finally agreeing with the differ. On MySQL that removes a permanent destructive drift finding: `columnInfo()` reports `maxLength: 65535` for a `TEXT` column, so every bounded text field already reported `narrow_varchar` ("metadata caps at 32 chars but the column allows 65535") against a column the driver itself had created.
  
  **Scope, both halves load-bearing.** The bound is emitted only for a column some declared index **keys on** — a non-indexed `Field.text({ maxLength: 65000 })` stays `TEXT`, because `varchar(65000)` on utf8mb4 is 260000 bytes and would blow MySQL's 65535-byte row limit, turning a working table into an un-creatable one. And only where the bound is **usable as a key part**: `maxLength` absent, or wider than 768 characters (3072 index bytes ÷ 4 bytes per utf8mb4 character — measured: `varchar(768)` takes a unique index, `varchar(769)` is refused with `ER_TOO_LONG_KEY`), leaves the column `TEXT` and the index refused with a message naming the field and the declaration that fixes it.
  
  **⚠️ Graded `minor`, not `patch`: this changes declared behaviour on newly created tables.** A keyed bounded text column now enforces its declared length where the dialect enforces `varchar` (Postgres and MySQL), so a write longer than `maxLength` that previously landed in an unbounded `TEXT` is now refused — under `STRICT_TRANS_TABLES`, with `ER_DATA_TOO_LONG`. That is the declaration becoming enforced rather than a new restriction, and it is exactly what makes the column indexable, but it is a behaviour change and is named here as one. **Existing tables are unaffected**: schema-sync is additive and never rewrites a column that is already present.
  
  **A prefix index is deliberately NOT substituted for an unkeyable column.** For an ordinary index that would be a transparent access-path choice, but for a `UNIQUE` one it silently replaces the declared constraint with a stricter one — uniqueness of the *prefix*. Measured on MySQL 8.0.46 with `UNIQUE KEY (token(191))` and two distinct 200+ character tokens sharing their first 191 characters: the second insert was rejected with `ER_DUP_ENTRY` **even though the tokens differ**. On `sys_session.token` that is a valid sign-in refused as a duplicate. The refusal an operator can read is strictly better than a constraint that quietly means something else.
- 64505a5: fix(driver-sql): stamp `updated_at` at the audit column's own precision on MySQL, so an updated row stops reading as modified BEFORE it was created (#11224)
  
  `createAuditTimestampColumn` builds the audit columns on MySQL as `DATETIME(3)`
  defaulted with `now(3)`, and its docblock says why in as many words
  ("`CURRENT_TIMESTAMP` has to carry matching precision for a `DATETIME(3)`
  default", #3942). `updatedAtStamp()` — the value every UPDATE door writes into
  that same column — was a bare `knex.fn.now()`, which compiles to an unqualified
  `CURRENT_TIMESTAMP` that MySQL truncates to whole seconds. So the column was
  created at millisecond precision on purpose and then written at second precision.
  
  Measured on live MySQL 8.0.46, against the exact schema the driver produces:
  
  ```
                              created_at                 updated_at              delta
  before  CURRENT_TIMESTAMP     2026-08-23 10:22:36.799   2026-08-23 10:22:36.000  -799 ms
  after   CURRENT_TIMESTAMP(3)  2026-08-23 10:22:36.799   2026-08-23 10:22:36.802    +3 ms
  ```
  
  Nothing errors. Three silent consequences, in ascending order of damage:
  
  1. **"Last modified" precedes "created".** Any consumer comparing the two — an
     audit answer, a "modified since creation?" badge, a data-quality check —
     reads a row that WAS modified as if it were not.
  2. **A delta / incremental sync SKIPS the row.** A cursor held at millisecond
     precision (`updated_at > cursor`) misses every row whose stamp was truncated
     back below it. Measured: all six rows in the new suite's §2 were invisible to
     their own cursor immediately after being updated. This is the same
     silent-wrong-answer family as #11067 / #11176 / #11223, reached by a fourth
     mechanism.
  3. **Two updates in the same second are indistinguishable**, so an
     `order by updated_at` over them is unstable exactly where it matters most.
  
  The fix is the expression #11176 had already derived and measured for the UPSERT
  door: `now(3)` on MySQL, unchanged elsewhere. Every UPDATE door reads one helper
  (`update`, `updateMany`, `rotatedUpdateById`), so all three move together.
  
  **Postgres and SQLite emit byte-identical SQL to before, and that is a
  measurement rather than an assumption.** Postgres' `CURRENT_TIMESTAMP` is
  `transaction_timestamp()` at microsecond precision against a `timestamptz`
  column; SQLite's stamp is a JS ISO-8601 string that already carries millis.
  Neither has anything to truncate. The new suite runs every cell on SQLite AND on
  live Postgres AND on live MySQL, and its §5 pins which expression each dialect
  gets — so a future "just add `(3)` everywhere" cannot satisfy the ordering
  assertions while changing the SQL the other two dialects emit. In the baseline
  run against the unfixed driver, the SQLite and Postgres cells were green (7/7
  each) and only the MySQL cell was red (6 of 7).
  
  **BREAKING**, narrowly, and the reason this is not a patch: the `protected`
  `upsertUpdatedAtStamp()` that shipped in 17.2.0 with #11176 is **removed**. It
  existed only to hold the precision-matched form for the upsert door without
  changing the SQL every `update()` emits — a split that card made deliberately
  because it had not measured the UPDATE door. This one measured it, so the pair
  collapses back into the single `updatedAtStamp()`, which now carries the matched
  precision for both doors. A subclass of `SqlDriver` that OVERRODE
  `upsertUpdatedAtStamp()` would otherwise have kept compiling while silently
  ceasing to be called, which is precisely the failure mode a release note has to
  name out loud. Such a subclass should override `updatedAtStamp()` instead; the
  two in-repo subclasses (`SqliteWasmDriver`, `TursoDriver`) override neither and
  are unaffected. Nothing else was removed or renamed, no authored metadata
  changes, and no public API moves — under this repo's launch-window convention
  (breaking changes ship as `minor` while the stack versions in lockstep) `minor`
  is the honest slot.
  
  Stored data is not rewritten. Rows updated before this change keep their
  truncated `updated_at`; the ordering invariant holds from the next write onward.
  
  <!-- adr-0087: not-required (no-migration-prescription) A precision fix to the value one builtin audit column is written with, plus the removal of a `protected` driver hook that has no authorable face. No authorable key, export, config field or stored `sys_metadata` shape changes, so there is nothing for `objectstack migrate meta` or the upgrade guide to carry — a subclass that overrode the removed hook moves its override to `updatedAtStamp()`, which is a code edit rather than a metadata migration. -->
- 4a4a35d: feat(driver-sql): compile the `addDays` offset of a `{ $field }` reference on every dialect
  
  `{ completed_at: { $lte: { $field: 'due_date', addDays: { $field: 'grace_days' } } } }`
  now compiles to `completed_at <= due_date + grace_days days` on SQLite, PostgreSQL and
  MySQL (`driver-sqlite-wasm` inherits the compiler unchanged); a literal (`addDays: 5`,
  `addDays: -3`) binds as a parameter where the column would be. The offset rides the
  cross-field arm and its four rulings — the offset column is a same-table, declared,
  non-tenant numeric column — and adds two of its own: day arithmetic applies only between
  two `date` columns or two `datetime` columns, and a fractional offset value is truncated
  toward zero. Everything else is refused with `INVALID_FILTER` (400), operands withheld from
  the caller and named in the server log.
  
  The NULL semantics are written into the predicate rather than left to three-valued logic:
  `COALESCE(offset, 0)` for a NULL offset column, and `referenced IS NOT NULL AND …` so a NULL
  referenced column is false — not NULL — for every operator including `$ne`, and stays false
  under `$not`. SQLite adds days on the driver's canonical text form (`date(col, 'N days')` /
  `strftime('%Y-%m-%dT%H:%M:%fZ', col, 'N days')`), so a shifted value is byte-identical to a
  stored one and the comparison stays a plain text compare.
  
  The shared cross-field conformance corpus gains an offset fixture with literal, column,
  negative, NULL-offset, NULL-base and `$not`-wrapped rows, held to the same ids on the SQL
  path and the in-memory evaluator; both driver suites run it, and the live PG + MySQL job
  runs it per dialect.
- 107bb4b: driver-sql (MySQL): carry an over-long UNIQUE index on a hash-shadow column
  
  On utf8mb4 InnoDB a key part holds at most 3072 bytes (768 characters), so a
  full-value UNIQUE index over a longer column is inexpressible — an OAuth access
  token that is a multi-KB JWT cannot be made keyable by any declared bound.
  Measured on live MySQL 8.0.46, 7 of 44 exported platform objects failed
  `syncSchema` outright and landed registered with their declared uniqueness
  absent (Postgres 16.13: 0 of 44).
  
  Such a UNIQUE index is now carried by a driver-owned `<index>__hash` column — a
  `STORED GENERATED` `VARBINARY(32)` holding the full, untruncated SHA-256 of the
  key values — with the unique index on that column. Uniqueness is still enforced
  over the whole value: distinct values sharing a long prefix are both accepted
  (the property that ruled out prefix-unique indexes), NULLs stay distinct, and a
  composite tuple containing NULL conflicts with nothing.
  
  The shadow is created only *after* the server refuses the direct index, so the
  dialect divergence is selected by the error code rather than by a dialect check:
  Postgres and SQLite are byte-identical to before. Non-unique indexes are
  deliberately left refused — an index over a digest accelerates no lookup the
  planner can reach.
- 0e5bea6: New operator-run command `os migrate multi-value-columns`: migrates a stale `varchar`/`text` column to `json` where the field declares `multiple: true` — the `manual_column_type_change` drift `os migrate apply` reports and deliberately never reconciles for you (#11535, ruled C on #11700). Flags: `--apply` (default off), `--yes`/`-y`, `--force`, `--table <name>` (repeatable), `--database-url`, `--json`. **Dry-run contract: without `--apply` the command executes nothing at all** — it prints the exact statements and the database they would run against, opens no seam and issues no probe, and a run is verified to have left the column type and every row unchanged. `--apply` runs `@objectstack/driver-sql`'s own `manualJsonConversionSql` — newly re-exported from that package's index for this consumer, its only other change — i.e. the statement the drift finding itself prints (Postgres: one `ALTER … USING (CASE …)` with `json_build_array`; MySQL: the two row-shaping `UPDATE`s then `ALTER … MODIFY … json`), refuses to execute anything the finding does not contain verbatim, re-runs detection afterwards and exits non-zero if the finding has not cleared. SQLite is excluded — the stale column round-trips a real array there, so the finding is never raised. Rows corrupted before the column is migrated are out of scope, and the command is never invoked automatically: nothing on the boot path reaches it.
- c05b40b: Stop reading every PostgreSQL `Field.date` one day early on a process east of UTC
  
  On PostgreSQL a `Field.date` came back **one calendar day early** whenever the
  Node process ran east of UTC — an app container on `TZ=Asia/Shanghai` served
  `"apply_date": "2026-08-23"` for a row `psql` reads as `2026-08-24`. The stored
  value was always right; the read corrupted it, so the wrong day was already in
  the REST payload before anything rendered it. Worse than a display bug: an
  `afterUpdate` hook copying a date into a child record persisted the shifted
  value, writing the wrong day back into the database.
  
  `node-postgres` materialises OID 1082 (`date`) as a JS `Date` at **local**
  midnight, and `SqlDriver#toDateOnly` reads a `Date` with **UTC** components.
  East of UTC, local midnight is the previous day in UTC. Measured on PostgreSQL
  16, one stored row `2026-08-24`, only the process `TZ` changed:
  
  | process `TZ` | `pg` materialised | driver returned |
  |---|---|---|
  | `UTC` | `2026-08-24T00:00:00.000Z` | `2026-08-24` |
  | `America/New_York` | `2026-08-24T04:00:00.000Z` | `2026-08-24` |
  | `Asia/Shanghai` | `2026-08-23T16:00:00.000Z` | **`2026-08-23`** |
  
  Fixed at the parser rather than the reader: the driver now registers a
  connection-scoped type parser so `date` (OID 1082) and `date[]` (1182) arrive
  as their `YYYY-MM-DD` wire text and never become a `Date` at all — the same
  shape SQLite has always had, and the same shape MySQL already had via the
  existing UTC connection pin. `timestamptz` is untouched: an instant is what a
  `Date` is for, and `Field.datetime` depends on it. The parser is registered on
  the connections this driver opens, never through the process-wide
  `pg.types.setTypeParser`, so a host application's own `pg` clients keep stock
  behaviour.
  
  Reading local components in `toDateOnly` instead was measured and rejected:
  that helper is shared by the read, write and filter paths, and a caller's
  `new Date('2026-08-24')` is UTC midnight — local components would report it as
  `2026-08-23` west of UTC, i.e. the identical one-day error moved onto the write
  and filter paths. `toDateOnly` now documents the UTC clock as its contract.
  
  **If you worked around this, you can undo the workaround.** Running the app
  process with `TZ=UTC` is no longer a prerequisite for correct dates, and any
  app-side "+1 day" compensation on a PostgreSQL date read must be removed — with
  this release the driver returns the stored day, so a compensating shift now
  overshoots. Rows that were *written* through the old skew (a hook that copied a
  date it had just read) still hold the wrong day and need a data fix; nothing
  here rewrites stored data.
  
  One behaviour change beyond the corrected day: on PostgreSQL a raw read
  (`driver.execute(...)`, or knex used directly on this driver's connection) now
  yields a `string` for a `date` column where it previously yielded a `Date`.
  Values leaving `find()` / `findOne()` / `aggregate()` / `distinct()` were
  already normalised to `YYYY-MM-DD` strings and keep that type — only the day
  they name changes.
  
  Pinned by a process-zone matrix (`UTC`, `Asia/Shanghai`, `America/New_York`,
  `Asia/Kolkata`) that asserts it contains an east-of-UTC cell before it believes
  itself: the existing live-Postgres CI job runs at `TZ=America/New_York`, which
  is west of UTC, where the pre-fix read names the right day — which is why this
  was green in CI for as long as it was broken in production.
- a11c1a5: `signature` and `qrcode` join the bounded-string family end to end, closing the last measured hole #11794 left open (#11875, maintainer ruling 2026-08-25, option 1). Three seams move together, in the order that keeps declared = enforced at every step:
  
  - **Authoring (`@objectstack/spec`)**: `maxLength` / `minLength` become authorable on `signature` and `qrcode` — both types join `BOUNDED_STRING_FIELD_TYPES`, so `Field.signature({ maxLength: 64 })`, refused at the authoring seam since #11566, now parses. The refusal message for the remaining out-of-set types enumerates the set itself instead of a hand-written copy of it, and both authoring forms show the key for the same set.
  - **Write seam (`@objectstack/objectql`)**: the record-validator's `max_length` / `min_length` branch now reads the spec's `BOUNDED_STRING_FIELD_TYPES` instead of a hand-copied ten-type list, so a declared bound on `signature` / `qrcode` refuses an over-long value with a field-named ADR-0112 `max_length` envelope — boundary measured: exactly `maxLength` characters is accepted, one past it is refused, on insert and update. `secret` and `color` are deliberately NOT covered (opaque `sys_secret` ref per ADR-0100; short by construction — the ruling's explicit carve-outs).
  - **Storage (`@objectstack/driver-sql`)**: both types move from the catch-all's `varchar(255)` into the TEXT family, under exactly the invariant #11794 established — an unbounded TEXT column is permitted precisely because the write seam now enforces the declared bound. Measured on live MySQL 8.0.46 (`STRICT_TRANS_TABLES`) and Postgres 16: a 1000-character data-URI signature, previously refused by the server (`ER_DATA_TOO_LONG` / `22001`), lands in a column that reads back as `text` from `information_schema.COLUMNS` on both dialects and round-trips byte-identically. The #11374 keyed-and-bounded rule applies to them unchanged: a keyed, bounded column is emitted `varchar(maxLength)` and the server refuses exactly one character past the declared bound.
  
  Nothing about existing tables changes — `createColumn` runs on `CREATE TABLE` and `ALTER TABLE ADD COLUMN`, so the column it sizes is always empty; a pre-existing `signature` / `qrcode` column stays `varchar(255)` until an operator migrates it, and the additive sync never rewrites a column's type on its own.
- dfebfc8: feat(driver-sql,spec): one emission-identity source — `redshift`/`cockroachdb` DDL is refused by name, `pgnative` joins the Postgres family (#11991, landing the #11756 ruling)
  
  **BREAKING** accept-set narrowing on `SqlDriver`'s DDL path, shipped as `minor`
  under the repo's launch-window convention for breaking changes — and a widening
  in the same edit, so read both directions.
  
  Maintainer ruling, 2026-08-25 (#11756, verbatim 「同意」 on 「C，但 pgnative
  归入 Postgres 家族」). Three knex clients speak the PostgreSQL wire protocol
  without being the PostgreSQL this driver emits DDL for, and the driver had no
  opinion about any of them — it simply let knex compile whatever it compiles.
  Measured on `origin/main` before the change, one `CREATE TABLE` per client:
  
  ```
  pg / pgnative / cockroachdb   "body" text          primary key inline
  redshift                      "body" varchar(max)  primary key in a separate ALTER TABLE
  ```
  
  So on Redshift the pre-ruling behaviour was not a failure — it was a table of a
  different shape, built quietly, with the deployment finding out when it wrote
  data into it.
  
  **Refused (narrowing).** A `redshift` or `cockroachdb` datasource that reaches
  schema DDL — `initObjects` / `syncSchema`, `dropTable`, `rotateShards`,
  `reconcileManagedSchema` — now gets an immediate
  `UnsupportedDialectEmissionError`: code `SQL_DIALECT_EMISSION_UNSUPPORTED`
  (newly registered under `@objectstack/driver-sql` in `ERROR_CODE_LEDGER`),
  HTTP status `501`, and a message naming the client, every client the driver
  DOES emit for, and the supported way to keep the database — manage its schema
  out-of-band and boot with `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`. It throws
  before any statement is issued, so nothing is half-built. Connection, the
  connect bound and the #11389 calendar-day parser are untouched: the boundary is
  DDL only, drawn where behaviour was actually verified.
  
  **Recognised (widening).** `pgnative` is now a member of the Postgres emission
  family — knex resolves it to the same `postgresql` dialect and the same query
  compiler as `pg`, differing only in which npm binding carries the bytes. It was
  previously in neither the emission set nor the wire table, so a `date` column
  got a bare `CURRENT_TIMESTAMP` default (the server's calendar day, the exact
  #11550 defect) and no calendar-day parser. It now behaves identically to `pg`
  and carries the #11389 pin.
  
  **One source of truth.** The pair `cockroachdb, redshift` used to be
  hand-written into the connect-timeout table and again into the wire table. It
  is now declared once, as `POSTGRES_WIRE_ONLY_CLIENTS`, and both tables extend
  the emission sets through it — as does the refusal, which reads the same set.
  Adding a future pg-wire client is one edit, and the three answers cannot drift
  apart. `mariadb` is explicitly out of the ruling's scope and keeps its third
  state: neither recognised nor refused.
  
  <!-- adr-0087: not-required (no-migration-prescription) A DDL-emission scope narrowing plus one added client spelling, both inside `driver-sql`. No spec schema, no authorable metadata key and no runtime interface is removed, renamed or re-shaped: the value that decides the outcome is a datasource's knex `client`, which lives in deployment configuration rather than in any stored `sys_metadata` document, so `objectstack migrate meta` has nothing to rewrite and there is no tombstone to project. The channel that reaches an affected deployment is the refusal itself — raised at the DDL gate, before any statement is issued, naming the supported clients and the `skipSchemaSync` posture — and choosing between "move this datasource to a supported database" and "manage its schema out-of-band" is a deployment decision no migration entry can make on an operator's behalf. `pgnative` is a widening and needs no upgrade action at all. -->
- 9f4a6d5: feat(driver-sql,driver-turso,driver-sqlite-wasm): SQLite-family JSON columns declare `TEXT`; server dialects keep native JSON (#12738)
  
  A `Field.json` column — and any field with `multiple: true` — is now declared as
  the JSON column type the **target dialect actually has**. Postgres and MySQL are
  untouched: their native `json`/`jsonb` and `JSON` types are correct and stay.
  The SQLite family (plain `SqlDriver` on `sqlite3`/`better-sqlite3`, `TursoDriver`
  in all three transport modes, and `SqliteWasmDriver`) now declares `text`.
  
  **Why.** SQLite has no JSON type. It derives a column's *affinity* from
  substrings of the declared type name, and `json` contains none of the markers
  (`INT`, `CHAR`/`CLOB`/`TEXT`, `BLOB`, `REAL`/`FLOA`/`DOUB`), so it fell through
  to **NUMERIC** and converted number-like input on the way in — measured through
  raw SQL, a bare `'0123'` was stored as the integer `123`. `text` takes TEXT
  affinity, converts nothing, and is what SQLite's own JSON1 functions operate on.
  It is also what `RemoteTransport.mapFieldTypeToSQL` had spelled all along, so
  turso's two transports now agree instead of diverging on one column.
  
  ## The migration shape
  
  - **New columns only.** The change is to the DDL emitter. Schema sync is
    additive, so no existing column is altered, dropped or rewritten.
  - **Existing columns keep their declared type.** A column created before this
    release stays `json` and keeps NUMERIC affinity — including through an
    unrelated SQLite drift rebuild, which re-declares an introspected `json`
    column as `json` rather than converting it.
  - **Platform write-path behaviour is unchanged.** The `Field.json` codec stays
    injective and stays in force: what the platform writes and reads back is
    identical before and after, on legacy and new columns alike. Nothing on the
    read path consults the physical column type — `isJsonField` answers from
    metadata — so decoding is the same on both spellings.
  - **No new schema-drift findings.** The multi-value base-type finding is gated
    on the dialect where the column type is load-bearing (Postgres and MySQL);
    SQLite was already excluded, and the emitter now agrees with the differ
    instead of merely being excused by it.
  - **The visible difference is raw-SQL-only, and in the safe direction.** A value
    written to a JSON column by raw SQL (bypassing the driver) is preserved as
    text on a new column where it would previously have been coerced to a number.
    Nothing that was preserved before is coerced now.
- 4045b95: fix(driver-sql): make the SQLite `Field.json` codec injective — one encoding across all three dialects (#12380)
  
  **BREAKING** storage-format change for `Field.json` columns on SQLite (and the
  SQLite-backed `driver-turso` / `driver-sqlite-wasm`, which inherit this codec),
  shipped as `minor` under the repo's launch-window convention for breaking
  changes. Postgres and MySQL are **untouched** — this makes SQLite match what
  they have always done.
  
  `formatInput` now `JSON.stringify`s every `Field.json` value on every dialect,
  and `formatOutput` parses it back. That **deletes a dialect branch rather than
  adding one**.
  
  ## What was wrong
  
  Measured 2026-08-26 through the driver boundary on live SQLite, live Postgres
  16.13 and live MySQL 8.0.46, with each stored cell read back through a separate
  raw catalog query: **Postgres and MySQL were 17/17 faithful; SQLite was 13/17
  type-changed.** Three independent mechanisms, only two of them reversible:
  
  1. **Read-side.** `formatOutput` `JSON.parse`s every string in a json column, so
     a stored string whose *content* is valid JSON came back type-changed —
     `'true'` → boolean, `'null'` → null, `'[]'` → array, `'{"a":1}'` → object.
  2. **Write-side.** The column is declared type `json`, which contains none of
     `INT`/`CHAR`/`CLOB`/`TEXT`/`BLOB`/`REAL`/`FLOA`/`DOUB`, so SQLite's affinity
     rules fall through to **NUMERIC** and a bound number-like string was converted
     to INTEGER/REAL *before storage*: `'123'`, `'  123  '`, `'0123'`, `'1e5'`,
     `'1.0'`, `'-0'` were destroyed on disk. ⛔ Not reversible.
  3. **Native booleans.** `true` was stored as INTEGER 1 and read back as the
     number `1` — `formatOutput`'s `booleanFields` pass is keyed to declared
     `Field.boolean` *columns*, not to booleans inside a json payload.
  
  The contract decides which dialect is right, not strictness: `json`'s stored
  contract is `z.unknown()` because *"openness is now an explicit decision, not an
  accident of nobody checking"* (`packages/spec/src/data/field-value.zod.ts`). An
  explicitly-open contract admits both `123` and `'123'` as legal values of one
  field, so no driver may collapse them onto one representation.
  
  The live consumer is `sys_setting.value`, which is `Field.json`, and the settings
  service persists verbatim and reads back with no re-coercion by declared type —
  so the driver's answer is what the caller gets, on the dialect tenant
  environments actually run.
  
  ## What changes on disk, and what does not
  
  The DDL is unchanged — the column is still declared `json`, so NUMERIC affinity
  is still in force. The encoded form defeats it because a string's encoding
  carries its quotes (`'123'` → `"123"`, which is not a numeric literal). Pinned
  live rather than reasoned.
  
  For **new** writes the on-disk delta is exactly two classes:
  
  - **strings** are now quoted JSON text;
  - **booleans** are now TEXT `true`/`false` instead of INTEGER `1`/`0`.
  
  Objects, arrays, `null` and **numbers** are byte-identical to before (`123` bound
  as a number and `"123"` bound as text both land as INTEGER `123`).
  
  ⚠️ An out-of-band reader of a SQLite file — anything reading the table with its
  own SQL rather than through this driver — now sees quoted JSON text where it saw
  a bare value.
  
  ## The migration, and the limits of what it can recover
  
  `backfillCanonicalJsonEncoding` runs on `syncSchema`/`initObjects` for existing
  tables, the same posture and shape as the `backfillCanonicalDatetimes` and
  `backfillCanonicalTimes` storage-format migrations beside it: one `UPDATE` per
  column, failures logged and swallowed, correctness never contingent on it having
  run. It converts the **one on-disk class the pre-fix encoding left unambiguous** —
  a TEXT cell that is not valid JSON, which nothing but a stored plain string could
  have produced — into its quoted form. Idempotent by construction: the `WHERE` is
  the exact complement of the `SET`'s output, so a converted row cannot match again
  and re-running costs one scan and zero writes.
  
  ⛔ **It does not guess, because the rest cannot be guessed**, and two classes are
  therefore left exactly as they are:
  
  - **INTEGER/REAL cells.** A number, a boolean, and a number-like string eaten by
    NUMERIC affinity are the *same bytes* on disk — `123` the number and `'123'`
    the string are one INTEGER `123`. No migration can know which was written.
  - **TEXT cells that already parse.** A stored object `{"a":1}` and a stored
    *string* `'{"a":1}'` were byte-identical before this change. Re-quoting them
    would turn every legacy object and array into a string — corrupting the common
    case to guess at the rare one.
  
  ⇒ Those rows read after this change exactly as they read before it. **The class
  stops growing; it is not retroactively repaired.** Maintainer ruling 2026-08-26,
  with that cost accepted explicitly.
  
  The migration changes **no read**: a legacy plain string reads back as that
  string before it runs (via `formatOutput`'s parse fallback, kept for exactly this
  reason and now documented as the pre-#12380 read-side repair) and after it runs.
  It is a canonicalisation that makes the on-disk format uniform and injective
  going forward, not a repair of something that reads wrong today.
  
  ## What upgraders may notice
  
  Values that were being **corrupted** now read back correctly. Code that adapted
  to the corruption is what changes underneath: a boolean `Field.json` value that
  read back as `1` now reads back as `true`, and a string whose content is valid
  JSON now reads back as that string instead of the structure it looked like.
  Filters are unaffected — every scalar comparison operator on a json column is
  already refused by the driver (`JSON_COLUMN_INCOMPATIBLE_OPERATORS`), so no
  predicate could have been keyed to the old stored text.
  
  <!-- adr-0087: not-required (no-migration-prescription) A storage-codec change inside one driver: no authorable metadata key is removed, renamed or re-shaped, no `packages/spec` declaration changes, and the `json` field type's stored contract (`z.unknown()`) is exactly what it was — so there is no tombstone and nothing whatsoever for `objectstack migrate meta` to rewrite. The migration this change needs is over DATA ROWS, not metadata, and it is performed automatically by the driver at schema sync (`backfillCanonicalJsonEncoding`); there is no step an upgrader is prescribed to take, which is why no ledger entry could carry one. -->
- c49afd0: driver-sql: a string field's declared `maxLength` now shapes the column it gets
  
  `createColumn` mapped the string family — `string` / `email` / `url` / `phone` /
  `password` — with a bare `table.string(name)`, so every column took knex's
  default width of 255 and the field's own `maxLength` was never read. A field
  declaring a wider bound got a narrower column, and on a dialect that enforces
  `varchar` length the write was refused: measured through the driver's own
  `initObjects` on MySQL 8.0.46 and Postgres 16, a 300-character value written to
  a `maxLength: 1024` column came back `ER_DATA_TOO_LONG` and `22001 value too
  long for type character varying(255)` respectively. `schema-drift.ts` has always
  treated `varchar(field.maxLength)` as the expected physical shape, so every such
  column also reported permanent drift against a table the driver had just
  created.
  
  **This changes emitted DDL for existing declarations.** A field declaring
  `maxLength` now gets `varchar(maxLength)` in both directions — wider *and*
  narrower than 255. Only newly created columns are affected: `createColumn` runs
  on `CREATE TABLE` and `ALTER TABLE ADD COLUMN`, never on a column that already
  holds rows, so nothing is truncated and no existing column is rewritten.
  Narrowing a populated column remains what it was — the `narrow_varchar` drift
  op, category `destructive`, behind `os migrate apply --allow-destructive`.
  
  A declared bound above 16383 characters (MySQL's utf8mb4 `varchar` ceiling)
  makes the column `TEXT` rather than clamping it, since a clamp would reinstate
  the same defect. Fields declaring no `maxLength`, or a malformed one, keep
  `varchar(255)` exactly as before. `lookup` / `user`, `autonumber`, and the
  catch-all branch are deliberately unchanged — none of them stores the value the
  declared bound describes.
  
  Two matching corrections in `schema-drift.ts`, so the differ and the emitter
  agree on which declarations count: a `maxLength` that is not a positive integer
  is no longer read as a bound (`maxLength: 0` planned a destructive `varchar(0)`
  ALTER), and a MySQL `TEXT` column is no longer diffed as a `varchar` 65535 wide
  — MySQL reports `character_maximum_length` 65535 for `TEXT` where Postgres
  reports NULL, so on MySQL alone every bounded unkeyed text column had been
  reporting a permanent destructive `narrow_varchar` against itself.
- 1246b4c: fix(driver-sql): the varchar differ now expects what `createColumn` would actually emit, instead of a different rule (#12732)
  
  The managed-schema drift differ's varchar-length branch expected
  `varchar(field.maxLength)` for any bounded field, over a **pre-existing**
  column dialect `postgres`/`mysql` enforce. `SqlDriver.createColumn` does not
  build that for every bounded field — and disagreed with the differ in two
  measured directions:
  
  **An already-serving deployment stopped booting.** An UNKEYED, bounded
  text-family field (`text` / `richtext` / `signature` / `markdown` / …)
  reported `narrow_varchar` at severity `error`, category `destructive` — the
  one category `runArtifactBootMigrationGate` refuses a boot for — demanding
  the column be narrowed to a shape `createColumn` would never build: unkeyed,
  it leaves the column TEXT (`keyableTextLength` returns `null` unkeyed). The
  trigger was an ordinary, correct-looking edit: adding `maxLength: 50` to a
  legacy `varchar(255)` text column. The divergence changed no behaviour at
  all — the write seam already enforces the declared bound — so the refusal
  was over nothing.
  
  **A `safe`, dev-auto-reconcilable finding planned DDL MySQL refuses
  outright.** A base string-family field (`email` / `url` / `password` / …)
  bounded past `SqlDriver.MAX_VARCHAR_CHARS` (16383) reported `widen_varchar`
  at `warning`/`safe`, planning `ALTER … varchar(100000)` — `ERROR 1074 Column
  length too big` on MySQL, while Postgres accepted it: the dialect-divergent
  enforcement this package's conformance matrices exist to close.
  `declaredVarcharLength` returns `null` above the ceiling for the same reason
  `createColumn` never emits that DDL.
  
  This guard had already been patched at the call site three times for the
  same defect class (#11431 for `multiple: true`; #11794/#11875 for genuine
  TEXT columns) — each time by adding one more condition. This is that defect
  arriving a fourth time, through a column spelled `varchar` because an older
  release created it. Rather than a fourth patch, the branch now asks
  `SqlDriver.varcharColumnChars(field, keyed)` — the emitter's own read-only
  mirror of `createColumn`'s switch, already pinned against `columnInfo()` for
  every `FieldType` — what width `createColumn` would actually build. `null`
  means "the emitter would not make this a varchar," and the branch does not
  fire. Keyedness (`indexedKeyColumns()`, #11374) is threaded from
  `SqlDriver.detectTableDrift` into `diffManagedTable`, since a KEYED bounded
  text-family field legitimately takes `varchar(maxLength)` — the fix
  suppresses the false positive, not the branch itself; a keyed field over the
  same shape still reports.
  
  Graded `minor` rather than `patch`, mirroring the sibling drift-op change for
  #12121 in the opposite direction: an already-serving deployment that
  currently fails to boot over Case A will boot after this upgrade, and a
  `widen_varchar` currently eligible for dev auto-reconcile over Case B will no
  longer be planned — both are user-visible behaviour changes for an existing
  deployment (`os migrate plan`, `os migrate apply`'s counts, the boot-time
  `[schema-drift]` warn), not merely an internal correctness detail. `diffManagedTable`'s exported args object gains two **optional** parameters
  (`keyedColumns`, `varcharColumnChars`); omitting either keeps the pre-#12732
  behaviour unconditionally; this is additive to the object type and — unlike
  #12121's `DriftOp` union member — does not add a case any consumer's
  exhaustive switch must handle, so it is not itself a reason to grade higher
  than `minor`. Nothing is removed, renamed, or newly rejected, so this is not
  a breaking change. The category question (whether Case A's `destructive`
  should become a report) is deliberately **not** addressed here: the fix
  makes the false-positive stop firing entirely, so there is nothing left to
  downgrade, and downgrading it as a separate act would be gate-weakening the
  triage seat did not authorise.

### Patch Changes

- ef52884: `aggregate()` now answers an unresolvable column with the same refusal class as `find()` and `count()` instead of the generic `DATABASE_ERROR`/500 terminal — the #8790 refusal reaching the third read door (#11541). The dialect-named column is attributed to the clause the caller's own query names it in: a `groupBy` field or an aggregation `field` refuses with `INVALID_FIELD`/400 naming the column and the clause (the same code the protocol ingress gives this condition, #4254); a column named by neither clause is the WHERE, which answers #8790's `INVALID_FILTER`/400 refusal verbatim; a dialect wording that yields no column name keeps the #11455 terminal envelope unchanged, because no attribution is supportable there (#8931). Drivers extending `SqlDriver` (`driver-turso`'s embedded face, `driver-sqlite-wasm`) inherit the same answers.
- 9e1b2de: Fix a `500 DATABASE_ERROR` on any analytics cube query that buckets a measure by
  a time-dimension granularity (`"count by month"` and every other
  `timeDimensions[].granularity` shape).
  
  An analytics measure is addressed on the wire as `<cube>.<measure>`, and that
  dotted name is used verbatim as the driver-level aggregation `alias` — it is the
  key the caller reads its own number back under. `driver-sql` bound the alias
  through knex's `??` placeholder, which does not quote an identifier so much as
  parse one: it splits the value on `.` into `table.column` and re-quotes each
  segment. The statement therefore reached the database as
  ``count(*) as `showcase_delivery`.`count` `` — not valid SQL on any dialect — and
  was refused before it ran.
  
  The granularity was the router rather than the fault: `NativeSQLStrategy`
  declines exactly on a granularity, so an un-bucketed cube query was served by the
  native face (which already emitted the alias correctly) while a bucketed one fell
  through to this door. Aliases are now emitted as a single dialect-quoted
  identifier at every alias position on the aggregate and window-function builders;
  column *references* still bind through `??` and may still be qualified.
- 178f90c: Boolean aggregands now answer the ruled #11249 contract on every SQL dialect. On Postgres, `sum`/`avg`/`min`/`max` over a declared `boolean` field are lowered with a cast (`avg(cast("flag" as int))`) instead of reaching the server as `avg("flag")` — which PostgreSQL refuses with SQLSTATE `42883`, so those aggregations previously failed with `DATABASE_ERROR`/500. On every dialect, `min`/`max` results over a declared boolean are now presented as JSON booleans (`false`/`true`) at the driver boundary — previously MySQL (`tinyint(1)` storage) answered `0`/`1`. `sum`/`avg` answer arithmetic (`3` / `0.5` over a 3-true/3-false column); `count`/`count_distinct` are unchanged, and `min`/`max` over an empty window still answer `null`.
- f6fa22c: `min`/`max` over a **boolean** aggregand now answer the numbers `0`/`1` on every face — maintainer ruling 2026-08-28 (#11152, option A), superseding #11249's `false`/`true`: booleans aggregate as numbers, with no per-aggregate exception, so one flag column's `sum`/`avg`/`min`/`max` all answer in one numeric domain.
  
  FROM → TO, per face: `driver-sql` (every dialect, `driver-sqlite-wasm` included via the shared compiler) no longer re-presents `min`/`max` results over a declared boolean as JSON booleans — `false`/`true` → `0`/`1`; row reads (`find()`) still present booleans, and `min`/`max` over an empty window still answer `null`. `driver-memory` (data and analytics faces) and objectql's in-memory fallback compare booleans as the numbers they are worth — `false`/`true` → `0`/`1`; strings, dates and numbers reach the same comparison they always did. `driver-mongodb` wraps `$min`/`$max` in the same boolean-only `$cond` coercion `$sum`/`$avg` use — `false`/`true` → `0`/`1`; null/missing still pass through, so the empty window still answers `null`. A caller reading `min`/`max` over a boolean column as a JSON boolean should read the number (`0` is false-y, `1` truthy, so boolean coercion at the call site keeps working).
  
  The cross-driver aggregation conformance fixture (`AGGREGATION_ROWS`, `@objectstack/spec/data`) now carries the boolean column those rulings are pinned by: `flag` (3 true / 3 false), with cases for `sum`=3, `avg`=0.5, `min`=0, `max`=1, `count`=6, `count_distinct`=2 and a grouped `min` over the deliberately asymmetric groups — the reach gap #11065 and #11151 were both found through (a boolean aggregand no conformance cell could see) is closed.
- 84de7e3: fix(driver-sql): name the storage a declaration on a builtin column name loses, instead of discarding it in silence (#12015)
  
  `initObjects` emits `id`, `created_at` and `updated_at` itself and then skips any
  declared field colliding with one — `if (builtinColumns.has(name)) continue;`, with
  no warning, no throw and no record anywhere that the author's declaration had been
  dropped. Measured on live PostgreSQL 16.13: an object declaring
  `id: { type: 'text' }` boots green and gets `id varchar(255)` — `table.string('id')`,
  not TEXT. Measured here on SQLite: the same substitution, and a declared
  `maxLength: 12` on that field binds nothing. The driver is right to own its primary
  key and audit stamps; the defect was that it disagreed with the author in silence —
  the declared-≠-enforced shape that bites hardest on AI-authored metadata, where the
  mismatch surfaces much later as data behaving oddly.
  
  Every DDL path that drops such a declaration now says so, naming the field, the
  object, the attributes that were lost and what the platform's column actually is:
  
  - **create** — `while creating table "…"`, said before the CREATE runs, so the
    author hears it even when the CREATE goes on to fail for an unrelated reason;
  - **ADD COLUMN diff** — `while syncing existing table "…"`; this path drops the
    declaration for a different reason (the builtin is already in the table, so the
    diff never proposes it), and it is the path a stock upgrade takes;
  - **rotation shard** — `while syncing shard "…"`, covering both the shard-create and
    shard-column-sync branches.
  
  A warning on one path with silence on the others just moves the trap, so each path
  carries its own call and its own pin: a regression to a silent `continue` on one path
  fails by name rather than being absorbed by a sibling.
  
  **Only the STORAGE half is reported, because only the storage half is lost.** A
  declaration on a builtin column name still carries `label` (and the locales generated
  from it), `readonly`, `searchable` and the ADR-0113 write contract in `required` — all
  honoured on the platform's column exactly as on any other. So the diagnostic fires
  only when the declaration asks for storage the platform's own column does not deliver
  (a differing `type`, a `maxLength`, `unique`, `defaultValue`, `storage.notNull`, a
  `multiple` shape…) and stays silent when it does not: `created_at: { type: 'datetime',
  defaultValue: 'NOW()' }` describes precisely what lands, and says nothing.
  `id: { type: 'number' }` — an author expecting a numeric key — still fires.
  `id: { type: 'text' }` does **not**: varchar(255) canonicalizes to the field type
  `text`, so that declaration asks for precisely what the column delivers (#12131 —
  the delivery table recorded the knex builder name `'string'` there at first, and
  reported all 45 of the platform's own correct `id` declarations as disagreements). The storage/presentation split is one table
  (`builtin-column-collision.ts`) pinned against `FieldSchema.shape`, so a field key
  added later is classified deliberately instead of defaulting into silence.
  
  **Grade: `patch`, and deliberately.** Nothing about the accept set moves — every
  object that booted before still boots, the DDL emitted is byte-identical, no public
  type or metadata key changes, and the only observable difference is a line in the log
  for storage that was already being discarded. The platform still owns `id` /
  `created_at` / `updated_at`: this changes what the driver **says**, never what it
  **does**.
- 3bc2e38: fix(driver-sql): the builtin-column delivery table speaks the spec's field-type vocabulary, not knex's builder names (#12131)
  
  `BUILTIN_COLUMN_DELIVERY.id.type` recorded `'string'` — the **knex builder name** from
  `table.string('id').primary()` — and `undeliveredStorageAttributes` compares that value
  with `===` against a declaration's `type`, which is a spec `FieldType`. The two are
  different vocabularies, and `'string'` is not a member of the one being compared: it is
  absent from `FieldType`'s 49 options, `Field.string` is absent from the builder's keys,
  and `FieldSchema` refuses `type: 'string'` outright. So **no declaration could ever
  match it**, and the #12015 diagnostic reported every correct declaration on the
  platform's own key as a disagreement.
  
  Measured on a stock boot of `@objectstack/platform-objects`: **45 warnings, one per
  system object**, each saying `type: 'text' (the column is 'string')` about a
  declaration that was right all along. `varchar` canonicalizes to the field type `text`
  (`canonicalizeSqlType('varchar(255)') === 'text'`, `suggestFieldTypeForSqlType('varchar(255)') === 'text'`,
  `isCompatible('varchar(255)', 'text') === true` — all pinned in `type-compat.test.ts`),
  so `id: Field.text(...)` asks for exactly what the platform's column delivers. The
  delivery table now records `text`, and the 45 lines go silent because they were false,
  not because they were suppressed.
  
  `sys_migration.id`'s `maxLength: 128` was the one **honest** disagreement in that corpus
  — the column is varchar(255) — and it is removed rather than widened to 255. It bound
  nothing in any seam: the DDL discards a declared width on a builtin column name, and
  `validateRecord` skips `id` by name on both the insert and the update path (it is also
  `readonly`). Declaring a width that nothing enforces is the shape enforce-or-remove
  exists to prevent, and the 44 sibling system objects declare none.
  
  The classification pin now holds **every** entry in the delivery table to
  `FieldType.options`, so a builder name written there fails by name instead of surfacing
  as a corpus of false warnings. The fixtures in both #12015 pin files were written
  against the delivery table rather than against the source — `sys_presence.id` was spelled
  `type: 'string'` in the "silent" cases, which is why they passed while the same
  declaration as actually written warned. They now use the shapes as declared, and the
  firing cases declare a type that genuinely disagrees.
  
  **Grade: `patch` for both, and deliberately.** No door moves and no DDL changes: the
  platform still owns `id` / `created_at` / `updated_at`, the emitted column is
  byte-identical, every object that booted before still boots, and `BUILTIN_COLUMN_DELIVERY`
  is internal to the package (it is not re-exported from the package entry). The
  `platform-objects` half removes one metadata key that was measured inert in every seam
  that could read it. What changes is what the driver **says**.
- f9ffd01: `SqlDriver` now recognises knex's own **canonical** client spellings, so `client: 'postgres'` and `client: 'sqlite'` no longer silently lose every dialect-specific behaviour (#11550). `SqlDriverConfig` is `Knex.Config & {…}`, so every client name knex accepts was already declared valid, while `isPostgres` / `isSqlite` enforced two literals each — and `postgres` is the canonical name of the dialect whose registered aliases are `pg` and `postgresql`, `sqlite` likewise for `sqlite3`. Nothing failed on the unrecognised spellings; the driver just emitted the wrong SQL. The sharpest case: `nowColumnDefault` fell through to a bare `CURRENT_TIMESTAMP` default on a `DATE` column, which resolves the calendar day in the **server's** timezone — the exact defect ("a UTC-12 server records YESTERDAY") that method's Postgres branch exists to remove. The three getters, the connect-timeout table, the pg wire-protocol set and the MySQL UTC session pin now derive from one identity source per dialect family instead of four hand-written lists that had already drifted apart. What an already-recognised spelling (`pg`, `postgresql`, `sqlite3`, `better-sqlite3`, `mysql`, `mysql2`) resolves to is unchanged, and `redshift` / `cockroachdb` keep pg **wire** recognition without gaining SQL-**emission** identity — that remains an open support-scope decision (#11756).
- c804f0c: The stale multi-value column warning now names `os migrate multi-value-columns`,
  instead of telling operators ObjectStack will never fix the column
  
  The finding that reports a multi-value field left on a stale `varchar`/`text`
  column opened its remedy with **"ObjectStack will NOT change this column for
  you. Migrate it by hand"** and then printed raw SQL. That was true when it was
  written and became false the moment `os migrate multi-value-columns` shipped:
  there is now an operator-run command that does exactly this, with a dry run as
  the default, a confirmation prompt, and a post-run re-detection that exits
  non-zero if the finding has not cleared. Operators were being sent to hand-write
  DDL on a production table while the safer route sat one command away, unnamed.
  
  The message now leads with the command and keeps the hand-run statement after it
  for anyone without the CLI. Both surfaces an operator meets this on pick the
  change up, because both print `message` verbatim: the boot warning
  (`[schema-drift] …` on every restart) and `os migrate plan`.
  
  What has **not** changed is what the finding gates. It stays `severity: 'error'`,
  `category: 'needs_confirm'` — the artifact boot gate refuses a boot on
  `category === 'destructive'` and on nothing else, and every database this finding
  describes is already serving, so making the report louder must never be the thing
  that stops one from starting. No load-time or write-time refusal was added; the
  platform still never migrates the column on its own, per the ruling that it warns
  and ships an explicit operator-run migration rather than altering a customer's
  production table unattended.
  
  The dialect-specific statement stays embedded **verbatim**, which is a contract
  rather than formatting: a `ManagedDriftEntry` carries no dialect, so the CLI
  command recovers one by testing which dialect's statement the message contains.
  That coupling is now pinned from the emitting side as well as the consuming one.
- 9d3c04d: fix(driver-sql): `aggregate()` joins the enveloped read exits — a dialect error it
  cannot attribute now leaves as `DATABASE_ERROR` / 500 instead of raw (#11455)
  
  `SqlDriver.aggregate()` executed its statement **bare**. Every dialect error the
  backend raised left the driver as the backend's own error object: a `code` from
  the backend's vocabulary, **no `status`** at all, and a message opening with the
  compiled statement. `find()` and `count()` have carried the terminal ADR-0112
  envelope since #8931; this third read door was simply never given it.
  
  Measured on live PostgreSQL 16.13. The driver maps a `boolean` field to a real PG
  `boolean` column and `SQL_AGGREGATE_FUNCTIONS` lowers the arithmetic aggregates to
  a bare function name with no cast, so an ordinary analytics shape — a rate measure
  over a flag column — reached the server as `avg("flag")`:
  
  ```
  sum(flag) => THREW code=42883 status=undefined
               msg=select sum("flag") as "n" from "…" - function sum(boolean) does not exist
  ```
  
  A raw `42883` is on no list `@objectstack/rest` reads, so with `status` undefined
  a caller-shaped mistake was logged as an **unhandled server fault**, and the
  statement's shape travelled to the caller with it.
  
  `aggregate()` now composes the same `backendStatementFaultError` its two siblings
  do: `DATABASE_ERROR` / 500, asserting exactly one thing — *the backend would not
  run this statement* — with the dialect's own diagnostic written to the **server
  log** rather than the caller's message, and the original error kept as a
  non-enumerable `cause` so `isMissingTableError` and every other cause-following
  predicate stay truthful.
  
  **No new error code.** ADR-0112 D3/D4 closed the `StandardErrorCode` vocabulary,
  and D2's 2026-08-18 amendment retired three members on the reasoning that an
  unreachable-but-declared code teaches a branch that can never fire. The code here
  is the catalogued member the sibling read exits already answer with.
  
  **This is the envelope half only, and it decides no contract.** Whether the
  platform should *answer a number* for an arithmetic aggregate over a boolean (by
  casting in the lowering) or *refuse* is #11152's question, and #11249's for
  `min`/`max`. Nothing here pre-empts it: the envelope is raised from the **exit**,
  not from recognising `42883` or any wording, so it holds whichever way that card
  is ruled — and the three dialects' arithmetic answers are deliberately left
  unpinned (measured 2026-08-24: SQLite and MySQL's `tinyint(1)` both answer,
  Postgres refuses).
  
  Unchanged, and pinned as controls: the precise refusals this door already
  composed — an undeclared function (`INVALID_QUERY` / 400, #5907), a
  `count_distinct` with no `field` (`INVALID_QUERY` / 400, #6409), a
  per-aggregation `filter` (`NOT_IMPLEMENTED` / 501, #10576) — are all raised while
  the statement is *built*, upstream of the guarded execution, so none can be buried
  under the generic envelope. The accept set does not move: every condition that now
  takes the envelope failed before this change and fails after it.
- d29e42f: chore(driver-sql): pin the varchar-sizing type switch against the spec's `BOUNDED_STRING_FIELD_TYPES`, so the two lists cannot drift apart silently (#12017)
  
  `packages/spec` decides which field types may DECLARE a `maxLength`
  (`BOUNDED_STRING_FIELD_TYPES`, which `FieldSchema` and objectql's
  record-validator both read since #11989/#11875). `driver-sql`'s
  `varcharColumnChars` / `createColumn` switch decides which types get a column
  SIZED from that declaration. The two are related by reasoning and nothing
  asserted the relationship — so a type admitted into the spec's set without a
  matching hand edit to the driver's switch falls to the catch-all
  `table.string(name)` at knex's varchar(255): the author declares
  `maxLength: 2000`, the platform formally accepts the declaration, and the
  column refuses at 255. That is #11431's defect re-entering through a different
  door. #12119 is the proof it is reachable — admitting `signature`/`qrcode`
  required a hand edit to this switch that nothing would have caught if it had
  been forgotten.
  
  ⛔ No divergence existed: the lists were measured and agree. This adds the
  missing guard, and changes no runtime code.
  
  The pin asserts set EQUALITY over the spec's `FieldType` vocabulary — the types
  the switch sizes from a declared `maxLength` are exactly the types the spec
  permits to declare one — and identifies each type's branch by probing the
  driver's own dispatch, so no copy of either list is added. `'string'` is pinned
  separately as the switch's untyped default (`field?.type || 'string'`, knex's
  builder name, not a spec `FieldType`), which is why the equality is scoped to
  the declared vocabulary.
  
  Grade: `patch`, argued rather than defaulted. Not `minor` — no new public API,
  no widened accept-set, no behaviour change of any kind; the emitted DDL is
  identical. Not `skip-changeset` either, though this PR ships only a test: the
  package's published CONTRACT (a bounded-string field gets a column that honours
  its declared bound) becomes a checked invariant here, and the CHANGELOG line is
  the record a future reader needs when the guard goes red.
- 87ad30c: fix(driver-sql): the terminal backend-fault envelope declares the table the statement targeted, so a genuinely absent federated remote reads benign again (#13438)
  
  `isMissingTableError(error, readObject)` compares the dialect's missing-table
  phrase against the name the **caller** read — its API object name (#13324). For a
  federated object (ADR-0015) that is not the name in the statement:
  `registerExternalObject` records `external.remoteName` and `getBuilder` targets
  it. So a caller reading `crm_order` from an absent `legacy_orders` got a phrase
  naming `legacy_orders`, compared it against `crm_order`, and was told the failure
  was about some other relation — the **loud** verdict, for the one case the benign
  licence exists for. Nothing at the call site knows the mapping; it lives on the
  driver instance.
  
  Maintainer ruling 2026-09-01 (option 2 on the card): the driver declares the table
  it targeted on the envelope. `backendStatementFaultError` — the terminal of the
  `find` / `count` / `aggregate` read exits — now stamps the physical table the
  statement was compiled against (a federated object's `external.remoteName`,
  otherwise the object's own name, resolved exactly as `getBuilder` resolves it)
  onto the envelope under `@objectstack/types`' `DRIVER_TARGETED_TABLE` symbol.
  
  The member is **code-readable and serialisation-invisible** — a non-enumerable
  symbol key, the same discipline the envelope already applies to `cause`:
  `JSON.stringify(err)`, `{ ...err }` and `Object.keys(err)` never carry it. ⛔ It is
  never written into the message: #8931's disclosure clause stands, and the
  composed message still names only the caller's object. No new export from this
  package and no new error code; the envelope's `code` / `status` / `message` are
  byte-identical to before.
  
  Pinned live on SQLite, Postgres and MySQL: the declared table is the name the
  dialect's own phrase carries; an absent remote now reads benign through the real
  predicate while the same envelope without the declaration still reads loud (the
  control); a native object declares its own name and matches as before; and a
  relation the statement did **not** target (a view over a dropped base table)
  stays loud with the declaration present — the #13324 narrowing does not reopen.
- fcd0efc: fix(driver-sql): scope the Postgres `introspectForeignKeys` catalog read to the session's own schemas (#11201)
  
  The Postgres arm queried `information_schema.table_constraints` with
  `tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ?` and **no `table_schema`
  predicate at all**. Those views span every schema the session has privilege on,
  independently of `search_path`, so a table name that exists in more than one schema had
  all of their foreign keys merged into a single answer — including foreign keys from
  schemas the session can never reach unqualified.
  
  That is a wrong answer rather than a missing one, and it is consumed as fact:
  `introspectSchema` hangs the result on the table it just listed, and from there it reaches
  federated-object codegen, the persisted `external_catalog` (ADR-0015) and schema-drift
  comparison. A phantom foreign key makes a drafted federated object reference a table it
  does not reference.
  
  The fix is the pin the rest of the family already carries —
  `AND tc.table_schema = ANY (current_schemas(false))` — spelled and placed exactly as
  `introspectUniqueConstraints` spells it, which in turn follows `introspectSchema`'s own
  table listing. `introspectForeignKeys` was the last unscoped introspection arm; the two
  `pg_index`-based arms (`introspectIndexes`, `introspectPrimaryKeys`) reach the same scoping
  from the other side by resolving the name to an OID through `regclass`. No interface shape
  and no accepted input changes: a same-named table in another schema simply stops
  contributing foreign keys it never should have contributed.
  
  Measured on a live PostgreSQL 16.13. The regression pin
  (`sql-driver-11201-introspect-fk-schema-scope.test.ts`) builds the collision the repo's own
  live-PG isolation (#9350, one schema per test file in one database) already makes routine:
  two same-named tables in two schemas, each with a different foreign key. It first asserts
  the pre-fix predicate really sees both constraints — so the interesting assertion, an
  absence, cannot go green on a fixture that never collided — then requires the arm and
  `introspectSchema` to return only the current schema's. Reverse-verified: with the
  predicate reverted the pin fails with the neighbour's foreign key present in the answer.
  
  The MySQL arm of the same method was checked and is not affected: it already pins
  `TABLE_SCHEMA = DATABASE()`. SQLite has no schemas.
- 3f42920: fix(driver-sql): keep the logger's receiver at the nine detach-then-call sites — a class-based host logger no longer turns a durability warning into a `TypeError` (#12792)
  
  Nine sites in `sql-driver.ts` picked a log channel by **extracting** the method before
  calling it — eight on the durability channel and one on `info`:
  
  ```ts
  (this.logger.error ?? this.logger.warn)(msg, meta);   // 8 sites
  (this.logger.info  ?? this.logger.warn)(msg);         // 1 site
  ```
  
  `a.b` in *call position* passes `a` as the receiver; `(a.b ?? c.d)(…)` evaluates to the
  bare function first, so the call runs with `this === undefined`. A plain-closure logger
  does not read `this` and survives it — which is why no suite ever went red, since this
  class's own default sink and every test double in the package are closures.
  `@objectstack/core`'s `ObjectLogger` is a real class with prototype methods and no
  constructor binding — `error`/`fatal` reach for `this.writeErrorLike`,
  `debug`/`info`/`warn` for `this.write` — so a host that injects one got:
  
  ```
  TypeError: Cannot read properties of undefined (reading 'writeErrorLike')
      at error (packages/core/src/logger.ts:414:14)
      at SqlDriver.syncDeclaredIndexes (packages/drivers/driver-sql/src/sql-driver.ts)
  ```
  
  The asymmetry that makes it worth fixing rather than noting: these particular lines
  report **durability degradation and schema drift** — the channel that exists to be loud
  when a constraint the metadata claims is enforced is not. A throw there converts the one
  signal into silence plus an unrelated crash, and where the site sits inside the
  reconcile's own `try` the throw is swallowed and re-reported as
  `dev auto-reconcile failed` — a reconcile that really happened, announced as a failure,
  with the post-reconcile re-detect skipped so the next warning describes a state that is
  no longer true.
  
  The eight `error ?? warn` sites now call `logDurabilityFailure()` — the property-access
  helper this class already had, three lines from the docblock that explains it. The ninth
  is `info ?? warn` and reports a reconcile that **succeeded**, so it keeps its level with
  an in-place property-access spelling rather than being escalated onto the durability
  channel; escalating a functional report to `error` is the over-application AGENTS.md
  names as what makes `error` unreadable in the first place.
  
  **Why `patch`.** No export, signature, accepted input or rejected input changes, and no
  message text changes. A host whose logger is a plain closure object sees byte-identical
  behaviour — that shape worked before and is pinned unchanged. The one behaviour a
  consumer could observe is a subclass that overrides the `protected`
  `logDurabilityFailure`: eight more calls now route through its override. That method is
  already this class's declared verb for the durability channel and the fallback semantics
  at those sites are unchanged (`error` when the sink has one, else `warn`), so more calls
  honouring the override is the documented intent rather than a break.
  
  Also measured and recorded rather than assumed: **nothing composes an `ObjectLogger`
  into `SqlDriver` today**. The plugin's `onEnable` builds `new SqlDriver(config)` and
  never passes the kernel's logger, the constructor reads no `logger` key, and every
  `driver.logger = …` assignment in the repo is a test or a testkit; the one production
  seam that *can* install one is `SqliteWasmDriver`'s constructor, inherited straight into
  this class, and no caller passes it yet. So these were latent, not live — which decides
  urgency, not whether: a call that runs with `this === undefined` is a defect whatever
  today's wiring happens to tolerate.
  
  The regression pin (`logger-receiver-detach.test.ts`) uses **class-based** logger doubles
  whose channels dispatch through `this`, drives the real reconcile and the real
  declared-index sync against real SQLite, and adds a structural AST scan over
  `sql-driver.ts` for all four detach spellings — including the two a single-line regex
  cannot see, which is how this file's count was twice taken as a floor.
- dd4113e: fix(driver-sql): order the MySQL `introspectForeignKeys` read by the key ordinal (#11379)
  
  `SqlDriver.introspectForeignKeys`' MySQL arm read `information_schema.KEY_COLUMN_USAGE`
  with no `ORDER BY`. `ORDINAL_POSITION` is the key ordinal and was selected by neither the
  projection nor an order clause, so the row order of a composite foreign key's columns was
  whatever the query plan happened to yield.
  
  That order is load-bearing. `IntrospectedForeignKey` is a flat per-column record with no
  ordinal field, so a composite key is expressed as **ordered sibling rows** — `(x, y)
  references p (a, b)` is `x -> p.a` then `y -> p.b`, and there is nothing for a consumer to
  recover the position from if the rows arrive permuted. The Postgres arm pins this with
  `ORDER BY … k.ord`; the MySQL arm was leaving it to the optimizer.
  
  This is a determinism fix rather than the repair of a wrong answer, and the measurement is
  what distinguishes the two. On MySQL 8.0.46, a foreign key declared out of column sequence
  — `foreign key (second_col, first_col) references ooo_parent (pa, pb)` — came back in key
  order through this predicate with no `ORDER BY` at all. But on the same server, in the
  same session, over the same view, the sibling `introspectPrimaryKeys` predicate
  (`CONSTRAINT_NAME = 'PRIMARY'`) returned an out-of-sequence primary key in **column**
  order — `carrier_code` at ordinal 2 ahead of `shipment_id` at ordinal 1. `KEY_COLUMN_USAGE`
  therefore does not preserve the ordinal for free on this server: which of the two orders
  you get is decided by the `WHERE` clause, and nothing declared that. The foreign-key
  predicate was on the lucky side of a choice nobody made.
  
  Consumers that read composite foreign keys through `introspectSchema` — federated-object
  codegen, the persisted `external_catalog` (ADR-0015), and schema-drift comparison — now get
  the declared key order from MySQL by construction rather than by plan choice.
- 992161b: fix(driver-sql): `introspectUniqueConstraints` reports single-column uniqueness on all three dialects (#11202)
  
  `SqlDriver.introspectUniqueConstraints` returns a flat `string[]` that
  `introspectSchema` folds into a per-column `isUnique` flag, and the three dialect arms
  disagreed about what that list meant. SQLite pushed a column only when the unique index
  had exactly one column; the Postgres and MySQL arms returned **every member of every
  composite constraint**. So for `UNIQUE (a, b)` the same table read through Postgres
  claimed `a` alone is unique *and* `b` alone is unique — a claim the constraint does not
  make — while through SQLite it claimed neither.
  
  The divergence was latent rather than active until recently: the Postgres arm's query
  selected `c.column_name` with no alias `c` in scope, and the bare `catch {}` the method
  carried until #11161 turned every execution into `[]`. Live Postgres had therefore never
  once reported a unique constraint through this method. Repairing that query is what put
  three dialects into conflict on live systems for the first time.
  
  Per maintainer ruling 2026-08-23 (option A→B), the flag is now narrowed to
  **single-column uniqueness only**: a column is reported iff some unique constraint covers
  that column and nothing else. A composite constraint's members are deliberately absent —
  a per-column boolean is structurally unable to say "a and b are unique *together*", so
  setting it on both members asserts something different and false. Representing composite
  constraints is option B and waits for real demand; until it exists, an absent flag on a
  composite member means "not single-column unique", never "no constraint".
  
  All three arms now normalise their rows to a `UniqueConstraintMember` and decide through
  one predicate, so a fourth dialect cannot quietly acquire a fourth meaning. The Postgres
  arm additionally selects `constraint_schema` and keys constraint identity on
  `(schema, name)`: its answer spans `current_schemas(false)` and Postgres auto-names a
  unique constraint after the table and column, so two same-named tables in two schemas
  produce two different constraints under one name — keyed on the name alone they would
  fuse into an apparent two-member constraint and drop a genuinely single-column unique
  (the #11201 defect class, one method over).
  
  Two smaller corrections ride the same rewrite, both in the SQLite arm's handling of
  `PRAGMA index_info` rows: an expression-index term (`… ON t (lower(a))`) reports
  `name: null`, which the arm used to push into a `string[]` as a literal `null` — it is
  now discarded, while still counting toward the index's width so `(d, lower(e))` cannot
  read as single-column; and the returned columns are de-duplicated, so a column carrying
  both a `UNIQUE` clause and a hand-made unique index is named once.
  
  No interface shape and no accepted input changes, and `isUnique` is only ever *set* to
  `true`, so a column that stops being flagged carries `undefined` exactly as an
  unconstrained column always has. The one in-tree consumer is
  `introspectedSchemaToObjects` in `@objectstack/objectql`, which turns the flag into a
  drafted field's `unique: true` — it is the direct beneficiary: composite members no
  longer draft fields declaring a single-column uniqueness the database never enforced.
  
  Verified on embedded SQLite, including the consumer-visible `introspectSchema` fold; the
  live Postgres and MySQL cells are declared through the shared dialect matrix and run in
  the `Temporal Conformance (live PG + MySQL)` job. The narrowing predicate is pinned
  directly against each dialect's real row shape, so the Postgres and MySQL decision is
  measurable without a provisioned server. Reverse-verified by ablation: with the width
  filter removed, 9 of the new pins fail — the Postgres and MySQL row-shape cases, the
  end-to-end SQLite cell, and the `isUnique` fold.
- ebcc34e: fix(driver-sql): an unkeyable TEXT column whose field ALREADY declares a bound now names the real remedy (#12999)
  
  One message served two causes and was true of only one of them.
  
  `explainUnkeyableTextColumn` turns MySQL's `ER_BLOB_KEY_WITHOUT_LENGTH` /
  `ER_TOO_LONG_KEY` index refusal into operator-readable advice. It rendered
  every such refusal as *"the field declares no `maxLength` … declare
  `maxLength` on the field(s)"*. That is correct at CREATE time. On the UPGRADE
  path both halves are false: the additive sync adds columns and indexes and
  deliberately never rewrites a column's type (#3728), so once a release adds a
  bound to a previously unbounded keyed field (#12978 did exactly that for five
  `sys_notification_*` objects), the field declares a perfectly usable
  `maxLength` while the physical column is still TEXT. The index is refused
  again on every boot and the message tells the operator to do the thing they
  already did — in production, once per boot, which reads as the release that
  shipped the fix being broken.
  
  **What changed.** A second branch, selected per column on a criterion that
  needs both halves: the physical column is TEXT *and* `keyableTextLength` says
  a fresh create would have emitted `varchar(n)` for the field's declared bound.
  Both inputs were already in hand on the failure path — the `columnInfo()` read
  this method already performs, and the driver's `managedObjectFields`
  registration. That message names the column, the bound it already declares,
  that re-declaring changes nothing, and the remedy that does apply: convert the
  column to `varchar(n)` **by hand, with a backup taken first**, restating the
  FULL column definition on MySQL — `MODIFY` does not repeat a `NOT NULL` and
  silently drops a `DEFAULT` it does not restate — after which the next boot
  creates the index. A composite key that mixes a stale column with a genuinely
  unbounded one names both dispositions rather than sending the operator down
  one route for both.
  
  **What deliberately did not change.**
  
  - The CREATE-path message is **byte-identical**, and is what a field that
    really declares no usable bound still gets. A declared bound *wider* than a
    utf8mb4 key part can hold (768 characters) is not a stale column either — a
    fresh create emits TEXT for it too — so it keeps the CREATE message, whose
    768-character ceiling is the fact that operator needs.
  - The refusal stays **loud and stays a failure**. The index genuinely was not
    created and a declared uniqueness is genuinely unenforced; naming a better
    remedy is not a reason to downgrade or silence that.
  - The additive sync still does **not** rewrite the column itself. A widening
    `ALTER … MODIFY` takes an exclusive metadata lock on the table, which makes
    it a destructive, hard-to-roll-back action and a deliberate manual floor
    rather than something a boot may decide to do.
  
  Diagnostic text only: no schema, DDL, wire or API surface moves.
- d395692: Withdraw the never-honored `IntrospectedTable.indexes` promise and widen two
  introspection declarations to the measured emitted types (#11122, maintainer
  ruling 2026-08-23, option B — 「其他同意你的意见」).
  
  The spec's introspection contract (`schema-diff-service.ts`) declared
  `indexes: IntrospectedIndex[]` as REQUIRED, yet no producer has ever emitted
  it — a consumer typed against the promise read `undefined` with no compiler
  complaint. It also declared `defaultValue?: string` while the in-tree SQL
  driver passes `knex.columnInfo().defaultValue` through raw (measured on live
  SQLite: `null` for a column with no default, dialect-quoted strings such as
  `'abc'` otherwise; other producers report native values such as `true`).
  
  - `IntrospectedTable.indexes` is now **optional**, and absence is meaningful:
    an absent key means the producer did not read indexes; an empty array is a
    positive claim the table HAS none. Producers that did not look must omit
    the key rather than emit `[]`. Wiring the index read into
    `introspectSchema()` is explicitly NOT part of this change.
  - `IntrospectedColumn.defaultValue` is now `unknown` — consumers narrow
    before use instead of trusting a string promise no producer kept.
  - The SQL layer's extra `maxLength` fact (driver-sql / objectql
    `IntrospectedColumn`, driver-sql `PhysicalColumn`) widens from `number` to
    `number | string` — SQLite reports the string `"255"` where other dialects
    report a number.
  
  With the spec now telling the truth, the deliberate `Omit` workarounds in
  `@objectstack/driver-sql` and `@objectstack/objectql` (which carved
  `defaultValue` and `indexes` out of the spec types to keep the divergence
  visible) are retired: both packages' introspection types now extend the spec
  contract directly.
  
  Consumers that read `table.indexes` must guard for absence (none exist
  in-tree — the requirement was never honored, so today's readers would have
  crashed on `undefined` anyway); consumers of `defaultValue` must narrow from
  `unknown` before string operations.
- e40a28c: fix(driver-sql): a declared `Field.boolean` answers JSON booleans on MySQL's row-read doors (#11782)
  
  `formatOutput`'s boolean read coercion — and its per-column mirror
  `readPresentationKind`, which `distinct()` and the aggregate group-key /
  `min`/`max` tracking consume — was gated `isSqlite`-only. On MySQL the storage
  is `tinyint(1)` and mysql2 hands back a JS number, so a declared boolean
  answered `1`/`0` through `find()`, `distinct()` and aggregate group keys while
  SQLite and Postgres answered `true`/`false` — and, after #11635 presented
  aggregate `min`/`max` on every dialect, `max(flag) === true` and
  `row.flag === 1` disagreed on the same column over the same MySQL connection.
  
  Measured on live MySQL 8.0.46 before the fix: `find().flag` → `1` (`typeof
  number`), `distinct('flag')` → `[0, 1]`, aggregate group keys → `1`/`0`. The
  boolean presentation now runs on the two dialects whose stored boolean is a
  number (SQLite `INTEGER` 0/1, MySQL `tinyint(1)`); Postgres stores a real
  `boolean` node-pg already parses, so it deliberately stays outside the gate and
  its answers are byte-identical. A `NULL` boolean stays `null` on every door
  (absence is not `false`), and declared `number`/`string` columns are untouched.
- 7e83932: MySQL's row-size refusal now names the declarations that caused it (#11565). MySQL charges every bounded column's DECLARED byte width against a per-row budget, independently of the per-column `varchar` ceiling — measured on 8.0.46 through this driver, 15 fields at `maxLength: 1024` create and 16 are refused — and its own error names no column and no declaration, about a table its author described entirely in metadata. Schema sync now translates `ER_TOO_BIG_ROWSIZE` at both the `CREATE TABLE` and `ALTER TABLE ADD COLUMN` sites into the same failure re-worded: every varchar column the object produces, widest first, with its emitted width and its byte cost at the schema's real bytes-per-character (read from the server, not assumed), plus the fields that reach the budget while declaring nothing — `lookup`, `user`, `auto_number` and the option types all take `varchar(255)`. InnoDB's separate per-page limit answers with the same code and is reported with the number the server quoted rather than 65535. Deliberately a translator and not a pre-flight: it speaks only after the server has refused, so it cannot refuse an object MySQL would have accepted. Nothing is refused that was accepted before, and no other dialect is touched.
- 431d2fb: Retiring a shadow-carried UNIQUE index no longer leaves its generated column behind forever (#13056).
  
  `isHashShadowColumn`'s docblock is why the orphan-COLUMN drift pass skips a #11627 hash shadow, and it stated what happens instead: the column "is then cleaned up by the index's own removal path, not by a blind column drop". There was no such path. `dropIndexIfExists` issues one statement family — `ALTER TABLE .. DROP CONSTRAINT`, `DROP INDEX IF EXISTS`, `ALTER TABLE .. DROP INDEX` — and never touches a column. So when metadata stopped declaring the index, `diffManagedIndexes` reported it as an orphan, `os migrate apply --allow-destructive` dropped it, and the `VARBINARY(32)` STORED generated column survived keyed by nothing, while the orphan-column pass declined to report it forever, exactly as designed. A STORED generated column is recomputed and written on every INSERT and on every UPDATE touching its source columns, so a table accumulating retired declarations paid for them permanently and silently.
  
  The `drop_index` op now collects that column after dropping the index. Ownership is established first, never assumed — in the shape of #13015's `foreign` guard, a column the driver has not proved is its own is left in place and named in a warning rather than dropped: a column of that name that is **not generated** may hold user data, and a column some **other index still keys** is not this orphan (that second read is what makes "index first, then column" a checked precondition rather than an ordering comment). An unreadable catalog degrades to leaving the column alone.
  
  **Why the cleanup hangs off the op and not off `dropIndexIfExists`,** which has two other callers. The discriminator is not *which caller* but *is this index name coming back*, and only the op knows. `recreate_index` drops in order to re-create under the same name, and its shadow must survive: #13015's `reusable` branch re-keys the survivor in place instead of rebuilding the table around a regenerated STORED column, and a cleanup in the shared helper would destroy exactly that survivor on every rebuild. `replace_unique_index`'s legacy-name drop cannot reach a shadow at all — #13015 already excludes `isHashShadowCarrier` from legacy detection, in `diffManagedIndexes`, saying it does so *because* that op drops the legacy name. Both are pinned in the negative direction, since they are what a later move of the drop into the shared helper would break and nothing else would notice.
  
  **Why `patch` and not `minor`.** Nothing new is authorable, no export is added (the collector is `protected`), and no input that was accepted is now rejected or vice versa. What an operator will observe that they did not before is a `DROP COLUMN` in the applied set of a migration they had already opted into: the `drop_index` op was already `category: 'destructive'` and already required `--allow-destructive`, so the opt-in is unchanged — the difference is that it now finishes the job it named instead of leaving half of it on the table. A `drop_index` that finds the index already gone is now reported as *applied* rather than skipped when it collects the leftover column, because the apply did rewrite the table.
- 80f1dcd: **Fix:** `introspectForeignKeys`' Postgres arm no longer drops a cross-schema foreign key, nor returns a composite one as a cartesian product (#11324).
  
  The arm joined three `information_schema` views, and the correlations were wrong in two independent ways. Both were measured on live PostgreSQL 16.13, against the query as it stood after #11201, so neither was caused by nor repaired by that change.
  
  **A foreign key whose target lived in another schema vanished.** The join carried `ccu.table_schema = tc.table_schema`, which demands parent and child sit in the same schema. For a FOREIGN KEY constraint, `constraint_column_usage` describes the *referenced* side — that is exactly why the projection aliases it `referenced_table` — so its `table_schema` is the **parent's**, not the constraint's. A cross-schema reference therefore contributed **zero rows**, and the table reported having no foreign keys at all. That is the #7332 failure mode through a different door and it has no `onFailure` to consult, because nothing failed: `[]` does not read downstream as "I could not see it", it reads as *this table has no foreign keys*, and federated-object codegen, the persisted `external_catalog` (ADR-0015) and schema-drift comparison all act on it. Cross-schema references are the normal shape for the federated remotes ADR-0015 points this driver at.
  
  **A composite foreign key came back as the cartesian product of its columns.** The `kcu` ↔ `ccu` join carried no ordinal correlation at all, so an N-column key yielded N x N rows pairing every child column with every parent column. Measured, a 2-column key `(x, y) references p (a, b)` returned **four** records — `x -> a`, `x -> b`, `y -> a`, `y -> b` — where the answer is `x -> a`, `y -> b`. Because `IntrospectedForeignKey` is a flat per-column record, the two phantom pairs are indistinguishable from the real ones to every consumer: a wrong-shaped answer that type-checks.
  
  **The whole query moves to `pg_constraint` rather than the join predicate being patched.** `constraint_column_usage` exposes no ordinal column at all — measured, its seven columns are the catalog/schema/name triples for the table and the constraint plus `column_name` — so the composite half has nothing to correlate on inside `information_schema`. The conservative half-fix was tried and measured: correlating `ccu` on `tc.constraint_schema`, the spelling `introspectUniqueConstraints` already carries, repairs the cross-schema case and leaves the composite case at four rows. `pg_constraint` carries both facts on one row — `conkey` and `confkey` are parallel `smallint[]`s in key order — so unnesting them *together* pairs child column with parent column by construction, and `unnest(...) WITH ORDINALITY` keeps the key position the old join threw away. That is the shape `introspectPrimaryKeys` already uses for `indkey` (#11101 / #11162), and dropping to the catalog matches what that arm and `introspectIndexes` already do.
  
  **No interface change.** `IntrospectedForeignKey` keeps its flat per-column shape and gains no ordinal field. A composite key is expressed as **ordered sibling rows** — contiguous, in declared key order, each pairing its own child column with its own parent column — which `ORDER BY con.conname, con.oid, k.ord` now pins and the type's docblock now states. Measured on a key declared out of column sequence, `foreign key (second_col, first_col)`, the result is key order rather than column order. An ordinal field was considered and rejected: it would let a wrong `ORDER BY` keep shipping wrong rows that merely *describe* their wrongness, where the pairing is a fact the query itself has to get right.
  
  Schema scoping is unchanged in meaning: `ns.nspname = ANY (current_schemas(false))` is #11201's `tc.table_schema = ANY (…)` expressed over the catalog, so a same-named table in a schema `search_path` never reaches still contributes nothing. An unknown table name still yields an empty list rather than a throw, so the #7332 `onFailure` contract is untouched.
- 6c6157a: `os migrate plan` / `apply` examine the object set the composed host DECLARED, and report the boundary when they cannot
  
  A composed host stack (#12938) registers its plugins for their DECLARATIONS: `init()` runs, `start()` is suppressed. The pass that hands every registered object to its driver — the one that fills the `managedObjectFields` map `detectManagedDrift()` diffs — lives in `ObjectQLPlugin.start()`, and a host that brings its own `ObjectQLPlugin` (under the framework's own plugin name, so the CLI's capability injector de-dups against it) DISPLACES the standalone one, since duplicate registration overwrites by name. The result was a boot where no `ObjectQLPlugin.start()` ran at all: every host plugin declared its objects, and not one reached a driver.
  
  Measured on ObjectStack Cloud's staging control plane: 36 host plugins composed, ~80 `sys_*` tables declared, **8** examined — all eight belonging to the single service that provisions its own tables from a `kernel:ready` hook rather than relying on that pass. Every consumer-visible signal was green, and `Physical schema is in sync with metadata` was one composed plugin away from printing over seventy unexamined tables.
  
  Two changes:
  
  - **The composed boot now drives that pass itself**, over the deferral it already armed: `engine.syncObjectSchema(name)` per declared object, which reaches `SqlDriver.initObjects` exactly as the suppressed `start()` would have. A plan still writes nothing — the deferral records the create-table work instead of running it.
  - **`plan` / `apply` report what they could NOT examine.** `--json` payloads gain `composition.coverage` (`registeredObjects`, `examinedObjects`, `unexaminedObjects`, and per-reason counts: federated, unbound, on another datasource, on a driver without schema registration, refused). When `unexaminedObjects > 0`, the human output refuses the unqualified "in sync" line and says the plan is PARTIAL instead. A consumer gate asserting coverage should read `composition.coverage.unexaminedObjects` — `managedTables` alone cannot tell a small deployment apart from a mostly unexamined one.
  
  `@objectstack/driver-sql`: `initObjects` no longer calls `ensureDatabaseExists()` while DDL is deferred. It is the one line there that can write — `mkdir -p` for a sqlite parent directory, and on Postgres/MySQL a `SELECT 1` that CREATEs the database on `3D000` / `ER_BAD_DB_ERROR` — and under the deferral there is no DDL for a database to exist for. `flushDeferredSchemaDdl` clears the flag before re-entering, so the confirmed `os migrate apply` still ensures the database ahead of the first `CREATE TABLE`.
  
  A project with neither an `objectstack.config.*` nor a compiled artifact is unchanged: it composes nothing, carries no `composition` key, and diffs the same five data-stack tables it always did.
- 6757eb2: A `redshift` datasource now gets the 10s dialect connect-timeout bound instead of silently degrading to the 15s pool backstop (#11784). `SqlDriver` answers three separate questions about a knex `client` name from three separate tables, and `redshift` was a member of the wire-protocol one (`POSTGRES_WIRE_CLIENTS`, which #11389 put it in so it gets the calendar-day parser pin) while absent from `DIALECT_CONNECT_TIMEOUT`. It reaches the server through the `pg` driver — knex's `Client_Redshift` literally `extends Client_PG` — so it has `connectionTimeoutMillis` and would have obeyed it; it just never received it, and `withConnectBound` skipped the injection. Nothing errored and nothing was logged: the bound was simply 50% looser than the method's own docblock declares ("the effective bound" at 10s, with `pool.createTimeoutMillis` a "strictly looser backstop, reached only by a dialect that has no connect-timeout knob (SQLite) or ignores the one we set"). A `redshift` host is neither of those. The practical consequence is the framework#3769 failure shape — an endpoint that accepts the TCP connection and never completes the handshake makes every query WAIT rather than fail, and the wait was bounded 5s later than declared, with knex's inaccurate "the pool is probably full" wording instead of pg's `timeout expired`. A host that sets its own `connectionTimeoutMillis` or `pool.createTimeoutMillis` is still left alone. `redshift` gains **no** SQL-emission identity from this: the connect-timeout knob is a property of the npm driver doing the connecting, not of which DDL dialect gets compiled, so this is independent of the open support-scope decision (#11756).
- 1c66fe4: fix(driver-sql): retire the lookup FOREIGN KEY branch gated on the rejected alias `reference_to`, and refuse the key instead of honouring it (#11567)
  
  `SqlDriver.createColumn` emitted `table.foreign(name).references('id')` for a
  relationship field carrying `reference_to`. `reference` is the only relationship
  spelling `@objectstack/spec` declares — `reference_to` is a **rejected alias**,
  answered by `FieldSchema` with `unrecognized_keys` and *"Did you mean
  `reference_to` → `reference`?"* — so that branch could not fire for any
  spec-conformant lookup, and never had.
  
  **This is not a behaviour change for any authored deployment.** Measured across
  all 44 exported platform objects on live PostgreSQL 16.13 and MySQL 8.0.46
  before the change: **0** FOREIGN KEY constraints. `reference_to` has zero
  non-test assignments repo-wide; the branch was reachable only by metadata that
  went around Zod through raw `registerObject` (which deliberately skips it).
  
  What changes is that the driver no longer disagrees with the spec in silence. A
  field still carrying `reference_to` at DDL time now throws
  `VALIDATION_ERROR`/400 naming it as a rejected alias of `reference`, in the same
  words `FieldSchema` uses, rather than quietly changing the physical schema. One
  key, one answer, on both doors.
  
  Fix, if you have such metadata — the same rename the schema has always asked for:
  
  | Wrote | Write instead |
  |---|---|
  | `{ type: 'lookup', reference_to: 'account' }` | `{ type: 'lookup', reference: 'account' }` |
  
  Referential integrity is unchanged and remains the **engine's**, applied via
  `deleteBehavior` (the `409 DELETE_RESTRICTED`) — which is what
  `content/docs/protocol/objectql/types.mdx` has documented since 2026-07-30.
  
  **Not graded as declared-breaking, deliberately.** ADR-0087's ledger reaches
  upgraders about *authorable metadata* that must be rewritten. `reference_to` is
  not authorable: the spec refuses it at the authoring door today and did before
  this change, so no conformant object definition behaves differently and no
  migration is owed to any deployment `objectstack migrate meta` can see. The
  prescription above exists for metadata that bypassed validation, not for a
  surface this repo ever published as writable.
- b826390: A `richtext` field now takes an unbounded TEXT column instead of knex's `varchar(255)`, so an ordinary rich-text body over 255 characters can be written (#11794). `createColumn`'s text-family case listed `text` / `textarea` / `html` / `markdown`; `richtext` — the third member of the spec's own "Rich Content" grouping in `field.zod.ts` — was in neither that case nor `JSON_COLUMN_TYPES`, so it fell through to the catch-all's `table.string(name)`. Measured at 1000 characters on live MySQL 8.0.46 and Postgres 16: before this change the write was refused by the server (`ER_DATA_TOO_LONG` under `STRICT_TRANS_TABLES`, `22001 value too long for type character varying(255)`) while the same body in a `markdown` field on the same table was accepted; after it, the column reads back as `text` from `information_schema` on both and the value round-trips byte-identically. `code` moves with it for the same reason.
  
  Membership is now decided by a stated, measured test instead of the hand-maintained case list that let one member of a three-member spec group diverge in the first place: a type may take an unbounded TEXT column exactly when the **write seam** enforces its declared `maxLength`, which is the invariant `schema-drift.ts` already rests on ("A TEXT column refuses nothing a `maxLength` allows … the bound is enforced at the write seam"). objectql's record-validator applies its `max_length` branch to `text` / `textarea` / `email` / `url` / `phone` / `password` / `markdown` / `html` / `richtext` / `code` and to nothing else, so both moved types keep a field-named ADR-0112 refusal for an over-declared value and the physical surface is restored to the declared contract rather than widened past it. The set of types that take an unbounded column when unkeyed is pinned as a whole, so the next addition has to be stated on purpose.
  
  `signature` and `qrcode` are **not** moved, deliberately and against the first reading of this defect. Their stored value is the author's own and routinely far past 255 characters (a data-URI PNG), so `varchar(255)` refuses ordinary values for them too — but the record-validator has no `max_length` branch for either, so an unbounded column would accept values a declared `maxLength` forbids: over-accepting in place of under-accepting, which is a physical surface wider than the contract. They stay bounded until the write seam can bound them, and the live-dialect suite asserts that refusal out loud rather than leaving it undocumented.
  
  The #11374 keyed-and-bounded rule applies to the two new members unchanged: a keyed, bounded `richtext` / `code` column is still emitted as `varchar(maxLength)` so a declared index can key it on MySQL, and a keyed but unbounded one still gets the named `explainUnkeyableTextColumn` refusal rather than a silently weaker constraint. Nothing about existing tables changes — `createColumn` runs on `CREATE TABLE` and `ALTER TABLE ADD COLUMN`, so the column it sizes is always empty.
- cd13488: A healthy hash-shadow-carried UNIQUE is no longer reported as destructive index
  drift — and the remedy that used to be proposed for it would have DROPPED the
  constraint
  
  On MySQL a declared UNIQUE whose key is too wide for an InnoDB key part is
  carried by a driver-owned generated column holding a SHA-256 of the key values
  (#11627). The index differ compared the declared columns against the columns an
  index physically KEYS, so a shadow-carried UNIQUE — one VARBINARY(32) generated
  column as the whole key — could never match. A clean `initObjects` reported the
  index the same boot had just created as `index_mismatch` / `destructive`, with
  `recreate_index` as the remedy and `os migrate apply --allow-destructive` in the
  message.
  
  Following that advice removed a live uniqueness guarantee. `recreate_index`
  drops the UNIQUE by name and re-runs the additive sync; the sync retakes the
  shadow route, and its `ALTER TABLE … ADD COLUMN` then failed on the generated
  column that **survived** the index drop. That failure is a duplicate-COLUMN
  error, matched by neither the "already exists" absorb (which spells index names)
  nor the unique-violation branch — so the apply ended with the constraint dropped
  and not re-created.
  
  Both halves are fixed, and they share one vocabulary rather than special-casing
  the differ. The orphan-COLUMN pass already recognised the shadow as driver-owned
  (`isHashShadowColumn`) while the index it carries was proposed for destructive
  rebuild; that asymmetry was the shape of the defect.
  
  - The shadow's name derivation moved next to that predicate, so the name the
    sync creates and the name the differ looks for have one definition.
  - Introspection reads the shadow's stored `GENERATION_EXPRESSION` and records
    the key it actually hashes, so the differ compares the key the constraint
    **enforces** instead of the digest column it stores. Drift reports and plan
    messages now name that key too, rather than `UNIQUE (uniq_…__hash)`.
  - The sync inspects a surviving shadow column instead of assuming it absent: a
    column already hashing the declared key is re-keyed in place, one hashing a
    different key is re-generated, and a non-generated column of that name is
    refused rather than dropped.
  
  Deliberately a real key comparison and not a blanket skip of every shadow. A
  shadow written before #12998 hashes the RAW columns, so `CONCAT` yields NULL for
  every NULL-organization row and the rows the `COALESCE(organization_id,
  '__global__')` bucket exists to constrain are constrained by nothing (#5030's
  shape) — indistinguishable by name from a healthy shadow. Skipping shadows
  wholesale would have traded one false destructive finding for a true silent one;
  that case is now reported as the ADR-0120 D4 tightening it is, runs the
  duplicate pre-flight before anything is dropped, and is repaired by the apply.
  A carrier whose expression cannot be read at all reports nothing rather than
  proposing a drop it cannot reason about.
- df1c75c: MySQL hash-shadow UNIQUE indexes (#11627) now hash the DECLARED key: the NULL-safe organization key part of an org-scoped unique (ADR-0120 D3) is embedded as `COALESCE(organization_id, '__global__')` inside the generation expression, so NULL-organization rows fold into the global bucket and collide with each other — the same key the direct index would have enforced. Previously the shadow hashed the raw columns, `CONCAT` returned NULL for every NULL-organization row, and a shadow-carried org-scoped unique silently enforced nothing on exactly the rows (single-tenant stacks, admin-global defaults) the NULL-safe key exists to constrain, while the boot log reported the constraint as carried. Plain composite shadows are unchanged: any-NULL tuples still conflict with nothing, matching MySQL's own composite-UNIQUE semantics.
  
  Deployment note — turning this constraint on is data-dependent: a MySQL database that accumulated duplicate NULL-organization rows while the shadow enforced nothing will fail the shadow `ALTER` with `ER_DUP_ENTRY` on its next boot. That failure is now diagnosed, not fatal: the boot continues, the log names the conflicting groups (probed over the same COALESCE key) and the operator action (`os migrate plan`, deduplicate, re-run), and the constraint is honestly reported as NOT enforced until the data is deduplicated — the same disposition as the direct NULL-safe route (ADR-0120 D4). Write-path duplicate diagnosis follows the key: a genuine NULL-organization duplicate is named in declared terms instead of being misreported as a hash collision.
- 07cced5: fix(driver-sql): `bulkUpdate` applies as one transaction, so a mid-batch refusal rolls back the rows already applied (#13854)
  
  `SqlDriver.bulkUpdate` is a sequential loop of individual `update()` calls — one
  per id, because each id carries its own patch and no single statement expresses
  N different SET lists. That loop had no transaction around it, so every
  `update()` autocommitted its own row. A batch refused partway through — a unique
  violation on a later row, a NOT NULL violation, any per-row failure from the
  database — left every row processed **before** the refusal permanently
  committed. The caller received an exception while the database held a state
  nobody declared: neither the pre-image nor the post-image, and a retry of the
  same array was not safe.
  
  The loop now runs inside a transaction, so the batch applies as one unit.
  `driver-turso` reaches this door through `super.bulkUpdate` and inherits the
  repair; no subclass change is needed or was made.
  
  Same defect class #13340/#13435 closed on `driver-memory`'s batch doors, on the
  production SQL driver. `bulkDelete` was measured and is untouched — it is a
  single `whereIn(...).delete()` per rotation shard, already atomic per shard.
  
  **Behaviour inside a caller's transaction.** When the caller supplies
  `options.transaction`, the batch runs in a nested transaction (a `SAVEPOINT`) on
  that same transaction rather than opening a competing one. A refused batch is
  undone as a unit, the caller's own surrounding work is untouched, and the
  caller's transaction stays usable — so a caller that catches the refusal and
  commits anyway no longer lands a partial batch.
  
  No API, signature or accepted-input change: every input accepted before is
  accepted after, and every refusal that fired before still fires. A missing id is
  still skipped rather than refused, unchanged.
- 3956069: fix(driver-sql): correct two comments in `createColumn` that cited a `Field.string` builder that has never existed (#12593)
  
  Two comments in the keyed/bounded text-family branch of `createColumn`
  (`signature` / `qrcode` / `richtext` / `code`) asserted a `Field.string`
  builder exists and that it "has always taken knex's `varchar(255)`." It does
  not exist and never has: `Field` has 37 keys and none is `string`,
  `FieldType.options` (49 entries) does not list it, and
  `FieldSchema.safeParse({ type: 'string', … })` fails at `[type]` — all three
  reproduced fresh on this branch, plus `git log -S` confirming no commit ever
  added such a builder key to `field.zod.ts`.
  
  The name is not arbitrary: `'string'` is knex's own column-builder method
  name (`table.string(name)`), reused internally by this driver as its
  *untyped* default (`field?.type || 'string'`) — a storage-side spelling that
  collides with, but is not, an authoring-side one. The corrected comments now
  state only checkable facts: knex's bare `table.string(name)` (no length) is
  `varchar(255)`; this branch never calls it bare, it calls
  `table.string(name, keyable)` with the field's own declared `maxLength`
  (up to `MAX_KEYABLE_VARCHAR_CHARS`, 768 chars); and the nearest *authorable*
  spelling that reaches this exact `varchar(n)` shape is `Field.text({
  maxLength: n })` on a keyed column — exactly what this switch arm already
  serves.
  
  No code changed — `git diff` is comment-only lines inside `sql-driver.ts`.
  Nothing here alters DDL, column widths, or any runtime behavior; the two
  pins that already exercise this exact branch behaviorally
  (`sql-driver-11565-row-byte-budget.test.ts`'s "agrees with createColumn about
  every FieldType" mirror, and `sql-driver-keyed-text-mysql.test.ts`'s
  "emits varchar(maxLength) for a keyed bounded field") both stay green,
  unmodified.
  
  **Grade: `patch`, and deliberately no higher.** This is documentation
  embedded in source, not an exported symbol, a spec key, or any authorable or
  runtime surface — there is nothing here for a consumer to migrate. `patch`
  is the correct floor for a fix that changes only what the driver's own
  source *says*, matching the sibling `builtin-column-delivery-id-type.md`
  changeset (#12131) that corrected the same false `Field.string` premise in
  an adjacent file. Not a declared-breaking changeset, so no ADR-0087
  disposition marker applies.
- 5dd3bc9: **Fix:** on SQLite the builtin `created_at`/`updated_at` audit columns now take the same canonical ISO-8601 `DEFAULT` a declared `Field.datetime` NOW() column in the same table already gets (#11321).
  
  `createAuditTimestampColumn`'s non-MySQL branch was `table.timestamp(name).defaultTo(this.knex.fn.now())`. On SQLite `knex.fn.now()` compiles to an unqualified `CURRENT_TIMESTAMP`, which renders a zone-**naive**, space-separated, second-precision `'YYYY-MM-DD HH:MM:SS'`. A declared `defaultValue: 'NOW()'` field in the **same table** already got `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` from `nowColumnDefault`, so one table carried two spellings of one conceptual value:
  
  ```
  created_at  "2026-08-23 14:54:17"          <- builtin audit  (naive)
  when        "2026-08-23T14:54:17.796Z"     <- declared field (canonical)
  ```
  
  That naive spelling is the one `updatedAtStamp()`'s own docblock condemns: `Date.parse` reads a zone-less string as LOCAL time, silently shifting the instant by the host offset on a non-UTC runtime. It is also the pre-canonical storage form `backfillCanonicalDatetimes` exists to converge — reached here by a path writing it *today*, not by legacy data.
  
  The SQLite branch is now routed through `nowColumnDefault('datetime')` — the existing single source for "what does NOW() mean in DDL on this dialect" — rather than restating the expression, so the two cannot drift apart again. **Postgres and MySQL are untouched**: `knex.fn.now()` on Postgres is a real zone-aware `TIMESTAMP` that never had the ambiguity, and MySQL keeps the `now(3)` precision match from #11224.
  
  `rebuildSqliteTablePatched` — the whole-table rebuild SQLite drift reconciliation uses — re-emitted the audit default itself as `knex.fn.now()`. That method is SQLite-only, so leaving it would have silently **reverted** a canonically-created table the moment any unrelated drift (a relaxed NOT NULL, an orphaned column) triggered a rebuild. Fixed in the same change: a rebuild hands back the column `initObjects` would have built.
  
  **Graded `patch`, not `minor`, on a measurement rather than a judgement.** The change alters emitted DDL, so the question that decides the grade is what it does to databases that already exist:
  
  - **Existing tables are not altered.** Both call sites are `CREATE TABLE` only; `initObjects`' `alterTable` branch adds declared fields and never the audit columns. A table already on disk keeps `default CURRENT_TIMESTAMP`.
  - **They do not start reporting drift.** Measured on live in-memory SQLite through the real `detectManagedDrift` entry point against a table carrying the old default: **zero** entries. Two independent guards — `BUILTIN_COLUMNS` skips `created_at`/`updated_at` in both of `diffManagedTable`'s loops, and the only `default_mismatch` producer is the #4560 runtime-token check, for which `isAppResolvedDefaultToken('NOW()')` is pinned `false`. The measurement carries a positive control: in the same call on the same table, drift reports `unmapped_column` **and** `default_mismatch` for a `current_user` column, so the default-reading dimension is demonstrably live and still says nothing about the audit columns.
  - **Rows already written naive keep reading correctly.** `formatOutput`'s `repairNaiveUtcAuditTimestamp` folds them to canonical on read — the same disposition `nowColumnDefault` already documents for declared fields.
  
  So no deployment changes behaviour on upgrade; only newly-created tables get the corrected default.
  
  The population this actually repairs is wider than "writes that bypass the driver". `stampInsertTimestamps` fills both columns app-side, but it gates on `tablesWithTimestamps`, which only DDL-running paths populate. On the documented `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` posture, `registerObjectMetadata` (the DDL-free registration door) deliberately does not touch that set — so the set is empty, the stamp returns early, and **the driver's own `create()` door reaches the column DEFAULT**. Measured, one table, one row per boot posture: `created_at "2026-08-23T14:54:17.791Z"` on a normal boot versus `"2026-08-23 14:54:17"` on a `skipSchemaSync` boot, with the declared NOW() sibling canonical in both — because its canonical shape lives in the column DEFAULT rather than in an app-side stamp. That asymmetry is the argument for fixing this in DDL, and it is now closed.
- 7adcd07: `introspectUniqueConstraints` no longer reports a PRIMARY KEY column as unique on SQLite, so all three dialects now answer the same question (#11654). The SQLite arm read `PRAGMA index_list` keyed only on `unique === 1`, and SQLite materialises a non-INTEGER primary key as a unique auto-index — so a `varchar` key was reported while the Postgres and MySQL arms, which filter on `CONSTRAINT_TYPE = 'UNIQUE'`, never see a primary key at all. It also disagreed with itself: an `INTEGER PRIMARY KEY` is a rowid alias with no auto-index, so the same logical schema produced a different `isUnique` flag depending only on the declared type of its key. The arm now skips `origin: 'pk'` index rows, which closes both gaps at once (`WITHOUT ROWID` keys included).
  
  This continues #11202's convention: `isUnique` means a *declared single-column UNIQUE constraint*. Nothing is lost — primary-key membership is still reported losslessly through `IntrospectedTable.primaryKeys` and `IntrospectedColumn.primaryKey`. The filter is on the index's `origin`, not on whether the column is in the key, so a key column that separately carries its own unique index stays flagged.
  
  Consumer-visible effect: `introspectedSchemaToObjects` in `@objectstack/objectql` turns this flag into a drafted field's `unique: true`, so a federated-object draft (ADR-0015) taken from a SQLite table no longer gains a redundant `unique: true` on its key column that the same table drafted through Postgres or MySQL never had. Drivers extending `SqlDriver` (`driver-turso`, `driver-sqlite-wasm`) inherit the change.
- f5a7f9c: **Fix:** on SQLite, `applyMigrationEntries` no longer reports an op as **applied** just because a table rebuild ran (#11722).
  
  `SqlDriver.applyMigrationEntries` splits by dialect, and the two arms disagreed about what `applied` means. The in-place arm (Postgres / MySQL) asks per entry and believes the answer — `applyDriftOpInPlace` returns `false` for an op its dialect cannot perform, and the entry goes to `skipped`. The SQLite arm did not ask at all: it called `rebuildSqliteTablePatched(table, ents)` and then `applied.push(...ents)`, every entry, unconditionally. But that rebuild honours exactly four op types — `relax_not_null`, `tighten_not_null`, `drop_column`, `drop_column_default` — and silently ignores everything else; its own docblock already said so for the varchar ops. An ignored op was still reported applied.
  
  **The failure mode is a false green, not an error.** Nothing throws and nothing is skipped, so every consumer announces work that never happened: `reconcileAndWarnDrift` logs `auto-reconciled <op> on <table>`, and the artifact boot gate prints `↪ migrated <op>`. The finding is still physically present, so the next boot detects it again, reports drift again, and "migrates" it again — a loop with no failing signal anywhere in it.
  
  **What changes.** `rebuildSqliteTablePatched` now returns the entries it actually acted on, built in the same pass that fills the four column sets it already partitioned into — deliberately not a second list of op types to keep in sync, so the returned set cannot drift from the work done. The caller reports those as `applied` and routes the remainder to `skipped`, logging it in the **same sentence** the in-place arm uses for an op its dialect cannot do (`<op> on <table>.<column> is unsupported on dialect 'sqlite' — skipped`), so one greppable line covers all three dialects. `@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso` extend `SqlDriver` without overriding either method, so both inherit the correction.
  
  **What deliberately does not change.** No op does anything different — this moves only what is *reported*. In particular the rebuild still runs for the whole table even when it honours nothing: it re-materializes every kept column's default (#11321, #4560) and the full declared index set from metadata (#3696), so it is not a no-op, and suppressing it would change what the reconciler DOES rather than what it says it did. `applied`/`skipped` remains a reported partition consumed by log lines and CLI counts; it is not an accept/reject door, and no public surface widens.
  
  **Latent when found, and fixed anyway.** The gap was unreachable at the time of the fix, held closed from two independent directions neither of which knew it was holding it: `enforcesVarcharLength` excludes SQLite, so the differ never emits `widen_varchar`/`narrow_varchar` there, and `multiValueColumnTypeIsLoadBearing` excludes SQLite for an unrelated measured reason, so #11535's `manual_column_type_change` is never emitted there either. The next column op that is not SQLite-rebuildable would have opened it silently. `manual_column_type_change`'s own docblock states that `applyMigrationEntries` reports it "skipped, never applied" — measured on Postgres and MySQL; that sentence is now also true on SQLite, and the docblock says so.
  
  Pinned by `packages/drivers/driver-sql/src/sql-driver-11722-sqlite-rebuild-applied-honesty.test.ts`, which constructs the reachability rather than waiting for it — it substitutes only the differ's dialect guard, handing entries straight to the public `applyMigrationEntries` seam that `os migrate apply` and the artifact boot gate both call, with a real driver, dialect and database throughout. All five cases fail on the pre-fix tree, including the consumer-level one that catches `auto-reconciled` being logged for an op that never happened.
- f24c90d: fix(driver-sql): route `updateMany()`'s payload through `formatInput` / `applyWriteColumnMap` (#11223)
  
  `updateMany()` was the only write door in `sql-driver.ts` that passed the caller's `data`
  straight to `builder.update(data)`. Every other one — `create`, `update`, `bulkCreate`,
  `upsert`, `rotatedUpdateById` — applies `applyWriteColumnMap(object, formatInput(object, data))`
  first, and the WHERE side of the very same bulk statement was already being translated by
  `applyFilters`. Measured on SQLite, live PostgreSQL 16.13 and live MySQL 8.0.46:
  
  - **`json` and `Field.multiple` values were refused.** Nothing stringified the structured
    value for the bind, so each dialect refused it in its own voice: `22P02 invalid input
    syntax for type json` on Postgres, `SQLite3 can only bind numbers, strings, bigints,
    buffers, and null` on SQLite, and on MySQL the array expanded into the SET list itself
    (``set `tags` = 'y', 'z'``) — a syntax error rather than a bind error. `update()` wrote
    the identical values correctly in the same run.
  - **A federated `external.columnMap` object's bulk update named a column that does not
    exist.** The WHERE was mapped and the SET was not, in one statement:
    ``update `legacy_p` set `name` = 'Bulk' where `full_name` = 'Renamed'`` → `no such
    column: name`. The door was unusable on every remapped external object.
  - **Temporal values were stored verbatim**, silently. On SQLite a zone-naive
    `'2026-05-06 07:08:09'` landed as-is — the pre-#3912 storage form
    `needsLegacyDatetimeRepair` exists to repair on read, written into a column
    `canonicalDatetimeFields` had already certified as canonical and therefore stopped
    repairing. Measured end to end: a range filter over that calendar day returned only the
    `update()`-written row, with the bulk-written row on disk carrying the right day and
    invisible to the query. On live Postgres the same literal was resolved in the **server's**
    timezone rather than UTC — `2026-05-06 07:08:09` stored as `2026-05-05T23:08:09.000Z`, a
    silent 8-hour instant shift on an `Asia/Shanghai` server. `Field.date` and `Field.time`
    were affected the same way: stored verbatim on SQLite, refused outright on the live
    dialects.
  
  The literal `'NOW()'` token now resolves on this door as it does on every other one; it
  previously stored the four-character string `"NOW()"` into a datetime column on SQLite and
  was refused by MySQL.
  
  #11176's `updated_at` stamping is unchanged in effect — the stamping decision now reads the
  formatted payload, matching `update()` and `rotatedUpdateById`, and the stamp is still
  applied afterwards as the literal post-map column name.
- Updated dependencies [809d417]
- Updated dependencies [387e231]
- Updated dependencies [f794e4e]
- Updated dependencies [cae2169]
- Updated dependencies [b812a54]
- Updated dependencies [2d4fa75]
- Updated dependencies [0e4e51b]
- Updated dependencies [e84bbf6]
- Updated dependencies [effae80]
- Updated dependencies [efb3513]
- Updated dependencies [d62f990]
- Updated dependencies [c45d8e6]
- Updated dependencies [2e3e8c7]
- Updated dependencies [e621291]
- Updated dependencies [655b106]
- Updated dependencies [40a93b5]
- Updated dependencies [101ad2c]
- Updated dependencies [d5b330d]
- Updated dependencies [dda969c]
- Updated dependencies [1f45690]
- Updated dependencies [277948f]
- Updated dependencies [8bdd955]
- Updated dependencies [f3bbbef]
- Updated dependencies [4f24e9d]
- Updated dependencies [e27583e]
- Updated dependencies [4bd6faa]
- Updated dependencies [86cbe37]
- Updated dependencies [6a180e4]
- Updated dependencies [474242f]
- Updated dependencies [63cd487]
- Updated dependencies [bd4aa4e]
- Updated dependencies [803eaab]
- Updated dependencies [f8e8f03]
- Updated dependencies [983edf1]
- Updated dependencies [eae824e]
- Updated dependencies [f6fa22c]
- Updated dependencies [8a483b3]
- Updated dependencies [97bcd99]
- Updated dependencies [df59de0]
- Updated dependencies [96e25a8]
- Updated dependencies [f75a38a]
- Updated dependencies [7a25e7d]
- Updated dependencies [1fa05a6]
- Updated dependencies [c85a265]
- Updated dependencies [dcb10a5]
- Updated dependencies [773a999]
- Updated dependencies [35dffea]
- Updated dependencies [d8024f0]
- Updated dependencies [8120808]
- Updated dependencies [776a098]
- Updated dependencies [5060877]
- Updated dependencies [4f6325d]
- Updated dependencies [52954c0]
- Updated dependencies [2aa8456]
- Updated dependencies [93809a3]
- Updated dependencies [7c0d0c3]
- Updated dependencies [daae7aa]
- Updated dependencies [8dc22d6]
- Updated dependencies [279431e]
- Updated dependencies [948dd6b]
- Updated dependencies [3b4c56c]
- Updated dependencies [ae8edd2]
- Updated dependencies [e25403c]
- Updated dependencies [a81aa9d]
- Updated dependencies [64baa68]
- Updated dependencies [9fa70d7]
- Updated dependencies [09db64a]
- Updated dependencies [92916e7]
- Updated dependencies [a84f3ea]
- Updated dependencies [f2eaae8]
- Updated dependencies [56c093c]
- Updated dependencies [c09451b]
- Updated dependencies [ba64877]
- Updated dependencies [e7191ce]
- Updated dependencies [7345308]
- Updated dependencies [79b6a22]
- Updated dependencies [30d96ab]
- Updated dependencies [f658793]
- Updated dependencies [c95ad19]
- Updated dependencies [e58ea8b]
- Updated dependencies [4a17645]
- Updated dependencies [3795c5f]
- Updated dependencies [8ab926b]
- Updated dependencies [7317cf2]
- Updated dependencies [e25e839]
- Updated dependencies [5997207]
- Updated dependencies [8b13cc8]
- Updated dependencies [4a4a35d]
- Updated dependencies [86e765a]
- Updated dependencies [1d7e76a]
- Updated dependencies [53dc739]
- Updated dependencies [fd289be]
- Updated dependencies [03bf7b1]
- Updated dependencies [f90e820]
- Updated dependencies [18d816a]
- Updated dependencies [e8bd715]
- Updated dependencies [b91c351]
- Updated dependencies [a28a3c0]
- Updated dependencies [daeaaf9]
- Updated dependencies [c459da6]
- Updated dependencies [e914733]
- Updated dependencies [f887e52]
- Updated dependencies [881f8d8]
- Updated dependencies [3bfa1e6]
- Updated dependencies [0a8ebf3]
- Updated dependencies [901355c]
- Updated dependencies [34ce8e7]
- Updated dependencies [33681ea]
- Updated dependencies [bfe13c8]
- Updated dependencies [0fb3044]
- Updated dependencies [4635f3e]
- Updated dependencies [fd289be]
- Updated dependencies [ee3595c]
- Updated dependencies [b2eab95]
- Updated dependencies [93940d4]
- Updated dependencies [3a04b01]
- Updated dependencies [45b9051]
- Updated dependencies [b9e9227]
- Updated dependencies [d395692]
- Updated dependencies [5894d30]
- Updated dependencies [a3765f6]
- Updated dependencies [2d5cee3]
- Updated dependencies [e22158f]
- Updated dependencies [7404925]
- Updated dependencies [0c2334f]
- Updated dependencies [778c59f]
- Updated dependencies [d2619fd]
- Updated dependencies [af56546]
- Updated dependencies [6acb11a]
- Updated dependencies [33c5fd3]
- Updated dependencies [20b0fdb]
- Updated dependencies [905019b]
- Updated dependencies [a286411]
- Updated dependencies [98c0d33]
- Updated dependencies [368a82e]
- Updated dependencies [a3d5724]
- Updated dependencies [93ea19b]
- Updated dependencies [9ee2dcf]
- Updated dependencies [8cb96ec]
- Updated dependencies [8f10a79]
- Updated dependencies [6269a55]
- Updated dependencies [a17da05]
- Updated dependencies [a8c00e2]
- Updated dependencies [22e5236]
- Updated dependencies [0fb8760]
- Updated dependencies [37e82eb]
- Updated dependencies [e5ce2ed]
- Updated dependencies [be21955]
- Updated dependencies [bc56e18]
- Updated dependencies [be21955]
- Updated dependencies [a9ee989]
- Updated dependencies [4d0d944]
- Updated dependencies [15d58db]
- Updated dependencies [d63b014]
- Updated dependencies [9abe4e4]
- Updated dependencies [2cc7122]
- Updated dependencies [50d6c92]
- Updated dependencies [9e0ba21]
- Updated dependencies [311433f]
- Updated dependencies [3e5ad08]
- Updated dependencies [9abe4e4]
- Updated dependencies [b7131f3]
- Updated dependencies [e5812fa]
- Updated dependencies [7085f90]
- Updated dependencies [dee4dd4]
- Updated dependencies [ce7e497]
- Updated dependencies [51ecb2f]
- Updated dependencies [9086761]
- Updated dependencies [42a117b]
- Updated dependencies [1401ae7]
- Updated dependencies [4297fe7]
- Updated dependencies [e398863]
- Updated dependencies [d16df74]
- Updated dependencies [f11fc61]
- Updated dependencies [e808890]
- Updated dependencies [8f79379]
- Updated dependencies [e6ca40e]
- Updated dependencies [0c77ea4]
- Updated dependencies [52954c0]
- Updated dependencies [89eb997]
- Updated dependencies [7131f12]
- Updated dependencies [aa5994e]
- Updated dependencies [be93457]
- Updated dependencies [a65db76]
- Updated dependencies [2cf5a96]
- Updated dependencies [15eb2c9]
- Updated dependencies [5691b07]
- Updated dependencies [2a6122b]
- Updated dependencies [225e769]
- Updated dependencies [8af88dd]
- Updated dependencies [fb5fbb8]
- Updated dependencies [d7b3963]
- Updated dependencies [33184fd]
- Updated dependencies [7c41693]
- Updated dependencies [b72db01]
- Updated dependencies [dce5cd4]
- Updated dependencies [9688f58]
- Updated dependencies [556ebc1]
- Updated dependencies [177ebdc]
- Updated dependencies [8d237b4]
- Updated dependencies [2d2e6f0]
- Updated dependencies [2d8dd8d]
- Updated dependencies [22d573e]
- Updated dependencies [b5a2398]
- Updated dependencies [348860c]
- Updated dependencies [5383fa6]
- Updated dependencies [5b3ff63]
- Updated dependencies [1a6a19c]
- Updated dependencies [527e050]
- Updated dependencies [dd33bf9]
- Updated dependencies [4cb2a90]
- Updated dependencies [74a7804]
- Updated dependencies [53d3689]
- Updated dependencies [b3a63d3]
- Updated dependencies [49f0dcf]
- Updated dependencies [033a34c]
- Updated dependencies [4d25d22]
- Updated dependencies [1ffee51]
- Updated dependencies [5ae4303]
- Updated dependencies [ece4dad]
- Updated dependencies [e9b377e]
- Updated dependencies [146f448]
- Updated dependencies [735f5c7]
- Updated dependencies [a7e18de]
- Updated dependencies [366f895]
- Updated dependencies [dc75ba8]
- Updated dependencies [cce0aa9]
- Updated dependencies [e764507]
- Updated dependencies [cff17af]
- Updated dependencies [39404f3]
- Updated dependencies [ca1965f]
- Updated dependencies [8619f95]
- Updated dependencies [b706af9]
- Updated dependencies [db8c288]
- Updated dependencies [0e5fe7f]
- Updated dependencies [add4360]
- Updated dependencies [fc9ba76]
- Updated dependencies [0f94cc7]
- Updated dependencies [a11c1a5]
- Updated dependencies [71f9cd1]
- Updated dependencies [ee17d86]
- Updated dependencies [cdbd920]
- Updated dependencies [18c432e]
- Updated dependencies [3c418c4]
- Updated dependencies [fa8715a]
- Updated dependencies [a933ed7]
- Updated dependencies [b3ca463]
- Updated dependencies [a933ed7]
- Updated dependencies [0d4a6a8]
- Updated dependencies [518d5e5]
- Updated dependencies [6643ba1]
- Updated dependencies [eeba2ef]
- Updated dependencies [ec4c4d2]
- Updated dependencies [424f73c]
- Updated dependencies [cccbe51]
- Updated dependencies [a8d6b1d]
- Updated dependencies [e4a7695]
- Updated dependencies [87075b1]
- Updated dependencies [fc58a99]
- Updated dependencies [14cfc00]
- Updated dependencies [1c6f7b4]
- Updated dependencies [e854a53]
- Updated dependencies [dfebfc8]
- Updated dependencies [d028b37]
- Updated dependencies [f7b25c5]
- Updated dependencies [122ef38]
- Updated dependencies [4a37870]
- Updated dependencies [428f9b2]
- Updated dependencies [aa7ff56]
- Updated dependencies [c41b42e]
- Updated dependencies [c4db311]
- Updated dependencies [750fff5]
- Updated dependencies [c19035e]
- Updated dependencies [ececf7a]
- Updated dependencies [d173125]
- Updated dependencies [8eeca27]
- Updated dependencies [8425c17]
- Updated dependencies [a5ef1d8]
- Updated dependencies [87ad30c]
- Updated dependencies [772d5de]
- Updated dependencies [ce80ec2]
- Updated dependencies [b372318]
- Updated dependencies [97a2263]
- Updated dependencies [29d0676]
- Updated dependencies [0169d49]
- Updated dependencies [6bd3231]
- Updated dependencies [d2b5ba8]
- Updated dependencies [b799ac5]
- Updated dependencies [8f74307]
- Updated dependencies [d23dc08]
- Updated dependencies [644ad50]
- Updated dependencies [9735662]
- Updated dependencies [4d5b4f8]
- Updated dependencies [0da7cd2]
- Updated dependencies [28a5c3e]
- Updated dependencies [4bc18e5]
  - @objectstack/spec@17.3.0
  - @objectstack/core@17.3.0
  - @objectstack/types@17.3.0
  - @objectstack/observability@17.3.0

## 17.2.0

### Minor Changes

- 95437e7: fix(driver-sql): `introspectSchema()` emits the spec introspection contract — `primaryKey`, `dialect`, `introspectedAt` (#10676, #10998)
  
  **BREAKING** change to the value `SqlDriver.introspectSchema()` returns, shipped
  as `minor` under the repo's launch-window convention for breaking changes.
  
  `packages/spec/src/contracts/schema-diff-service.ts` declares one introspection
  contract. The driver declared a second one beside it and, separately, so did
  `packages/objectql/src/util.ts`. The three agreed on the idea and disagreed on
  the vocabulary: the driver spelled a column's primary-key membership
  `isPrimary`, the spec spells it `primaryKey`; the spec declares `dialect` and a
  REQUIRED `introspectedAt` that the driver's schema type never mentioned and
  `introspectSchema()` therefore never emitted. Nothing was type-unsound — each
  side compiled against its own declaration and the value crossed between them
  with no compiler in the middle.
  
  Measured on a live in-memory SQLite database before this change: the id column
  of a `primary key (id)` table came back carrying `isPrimary: true` with no
  `primaryKey` key at all, and `Object.keys()` of the schema was `["tables"]`.
  Two consequences, both silent:
  
  - `ExternalDatasourceService.generateObjectDraft` reads `col.primaryKey`, so
    every federated object drafted from a real remote table lost the remote
    primary key — the addressing key for the federated table, dropped by the
    codegen meant to produce it (#10676).
  - type mapping ran with `dialect: undefined` across the whole federation path,
    making every per-dialect alias in `suggestFieldTypeForSqlType` unreachable
    there, and `refreshCatalog` persisted `dialect: undefined` into the
    `external_catalog` record Studio's schema browser and the boot gate read
    back (#10998).
  
  Maintainer ruling, 2026-08-22 (live session, 「同意所有」 item 9 =
  驱动侧对齐 spec 契约): `packages/spec` is the one contract and the driver
  aligns to it.
  
  What the driver now returns: every column carries the boolean `primaryKey`, the
  schema carries `dialect` and `introspectedAt`, and the retired `isPrimary`
  member is gone rather than emitted alongside — one spelling, so no consumer can
  key off the wrong one again. `dialect` is the driver's canonical dialect name
  (`sqlite`, `postgres`, `mysql`, `unknown`), which is the vocabulary the only
  in-tree consumer keys its alias tables on; `introspectedAt` is an ISO 8601
  instant stamped before the reads begin.
  
  `IntrospectedColumn`, `IntrospectedTable` and `IntrospectedSchema` in both
  `@objectstack/driver-sql` and `@objectstack/objectql` are now derived from the
  spec contract instead of re-declared, so a key added there fails their `tsc`
  until the producer emits it. Two divergences are kept explicitly: `defaultValue`
  stays `unknown` at the SQL layer because Knex reports `null`, and `indexes` is
  omitted rather than emitted empty because this driver does not introspect
  indexes and an empty array would tell a schema differ that a table has none.
  
  TypeScript consumers of the removed member are told by the compiler, precisely
  and at every site: `Property 'isPrimary' does not exist on type
  'IntrospectedColumn'`.
  
  <!-- adr-0087: not-required (runtime-interface-only packages/drivers/driver-sql/src/sql-driver.ts#IntrospectedColumn, packages/drivers/driver-sql/src/sql-driver.ts#IntrospectedSchema, packages/objectql/src/util.ts#IntrospectedColumn, packages/objectql/src/util.ts#IntrospectedSchema) these are published runtime TypeScript interfaces describing a driver's introspection RESULT — not a metadata surface. There is no Zod schema, no `packages/spec` declaration of the old spelling, and no stored representation of it, so `objectstack migrate meta` has nothing to rewrite; the channel that reaches every affected consumer is the compiler. -->
- 9cc1940: **BREAKING**: a failed primary-key / foreign-key / unique-constraint introspection read now throws instead of silently reporting absence (#11161).
  
  `introspectPrimaryKeys`, `introspectForeignKeys` and `introspectUniqueConstraints` wrapped their whole dialect dispatch in a bare `catch {}` and returned `[]`, so a query a live server rejected degraded to "this table has no primary key / foreign keys / unique constraints" with no diagnostic. `primaryKeys` is consumed as an addressing / upsert-conflict-target key (federated-object codegen, the persisted `external_catalog` under ADR-0015, schema-drift comparison), so the silent empty answer was a wrong answer downstream code acted on, not "we don't know".
  
  This extends the #7332 ruling the sibling `introspectIndexes` already carries, with the identical option shape and default: `onFailure?: 'throw' | 'partial'`, defaulting to `'throw'`. A caller whose short read is self-correcting may ask for one by name with `{ onFailure: 'partial' }`. Consequently `introspectSchema` over a partially-readable database now fails loudly instead of emitting tables whose keys silently read as absent; its in-tree callers already handle a throw (the datasource health check reports `{ ok: false }`, the REST/CLI introspection seams surface the error).
  
  The un-hiding immediately proved its worth: the Postgres arm of `introspectUniqueConstraints` had been invalid SQL all along (`SELECT c.column_name` with no alias `c` in scope — `missing FROM-clause entry`), so live Postgres never reported a unique constraint through this method. That query is repaired in the same change (alias fixed, and the lookup scoped to `current_schemas(false)` the way `introspectSchema`'s own table listing already is), so `isUnique` is now populated on Postgres for the first time.
  
  <!-- adr-0087: not-required (no-migration-prescription) runtime error-contract change on SqlDriver's protected introspection methods; no authorable metadata key changes shape, so `objectstack migrate meta` has nothing to rewrite -->

### Patch Changes

- 6936d07: `engine.aggregate` honours a per-aggregation `filter` (#10576, the contract
  half of #10413). `AggregationNodeSchema.filter` — declared since #4286 but
  marked experimental and enforced by nothing — is now live with SQL
  `FILTER (WHERE …)` semantics: the predicate narrows the SOURCE rows that one
  aggregation reads while sibling aggregations in the same call keep seeing
  every row of the group, so a measure-scoped filter (`stage: 'closed_won'`)
  can finally reach the engine instead of being silently dropped (the #10413
  wrong-numbers defect on the ObjectQL analytics path). The
  `StrategyContext.executeAggregate` bridge (`@objectstack/spec/contracts`)
  gains the same optional `filter` on its aggregation entries so analytics
  strategies can lower measure filters into it (#10413 phase 2 consumes this
  seam next).
  
  Execution is the correct-first two-tier shape date bucketing and HAVING use:
  the engine lowers filtered aggregations in memory for every driver (unknown
  operators refuse loudly with `INVALID_FILTER`/400 naming the aggregation
  position; a group emptied by its filter answers the ruled empty-group values
  — count/sum 0, avg/min/max null). No driver compiles conditional aggregation
  natively today, so each native aggregate face (driver-sql — inherited by
  driver-sqlite-wasm and Turso local —, the Turso remote transport,
  driver-mongodb's pipeline builder, driver-memory's `performAggregation`)
  refuses a directly-delivered per-aggregation filter with
  `NOT_IMPLEMENTED`/501 instead of silently aggregating the unfiltered rows.
  Aggregations without a `filter` are byte-identically unchanged, including
  their native pushdown path.
- 824a996: `updateMany()` and `upsert()`'s merge branch now advance `updated_at` (#11176).
  
  Two write doors were leaving "last modified" reading the row's previous value —
  on **every** deployment, DDL-managed or not (which is what separates these from
  #11067, whose defect needed `skipSchemaSync`):
  
  - **`updateMany()` stamped nothing.** No `tablesWithTimestamps` consultation, no
    `updated_at`. `update()`, `bulkUpdate()` and `rotatedUpdateById()` all stamp;
    this door did not, so a bulk edit left every row it touched reading its
    creation time.
  - **`upsert()`'s merge branch did not advance it on Postgres and MySQL.** The
    merge set is derived from the keys of the formatted payload, and
    `stampInsertTimestamps` — the only thing that put `updated_at` there — returns
    early on any non-SQLite dialect, because the column DEFAULT already stores a
    zone-aware instant on insert. A DEFAULT does not re-fire on the conflict path.
    **SQLite was accidentally correct; Postgres and MySQL were not.**
  
  Measured on live PostgreSQL 16.13 and MySQL 8.0.46, through the driver's own
  `initObjects`, with `update()` advancing the same column on the same table in
  the same run as the contrast.
  
  Nothing errored before this fix, which is why it went unnoticed: list-view
  sorts, delta/incremental sync, cache invalidation and audit answers simply read
  a stale `updated_at`. A bulk status change and a sync/import that upserts — the
  common shape for connector and seed writes — are exactly the operations most
  likely to be feeding a downstream delta consumer.
  
  No accept-set change and no new rejection. Both doors keep #3493's opt-in
  historical import (`preserveAudit` with an explicit `updated_at`) intact, and a
  hand-migrated table that genuinely lacks the column keeps working: `updateMany`
  reuses #11067's presumption-and-recovery machinery whole, and the upsert door
  stamps only where the column has been OBSERVED, never on a presumption it has no
  way to recover from. The SQL emitted for SQLite, and for any object with no
  observed `updated_at` column, is unchanged.
- 9cc1940: **Bug fix:** on Postgres, `introspectPrimaryKeys` no longer reports a covering primary key's `INCLUDE`'d columns as key members (#11162).
  
  For a primary key created as `CREATE UNIQUE INDEX … INCLUDE (payload)` and promoted with `ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY USING INDEX`, `pg_index.indkey` holds the key columns *and* the payload columns; `indnkeyatts` counts the leading entries that are actually key members and was never consulted, so `payload` came back as part of the key. Measured on a live PostgreSQL 16.13: `indkey = '2 1 3'`, `indnkeyatts = 2`, and the introspected key was `k2, k1, payload` for a declared `(k2, k1)`.
  
  A key with an extra member is a different key: an upsert conflict target naming a non-key column does not match the constraint, and schema-drift comparison against a correctly-declared key reports a phantom `unexpected_key_member`. The join is now bounded with `k.ord <= i.indnkeyatts`, which preserves the declared key order established by #11101. `indnkeyatts` exists on PG 11+; no change for ordinary (non-covering) primary keys.
- 9cc1940: **Bug fix:** `introspectColumns` (and therefore `introspectSchema`) now reports a table's columns in declared order on every dialect, read from the catalog's own ordinal (#11163).
  
  The column array was built from knex's `columnInfo()`, an object keyed by column name whose key-insertion order is the row order of a catalog query with no `ORDER BY`. Measured live: SQLite and PostgreSQL 16.13 happened to return declared order, MySQL 8.0.46 returned **alphabetical** order — so the same table introspected through different dialects returned different `columns` arrays, and a federated object drafted from a MySQL remote (ADR-0015) got its fields alphabetized rather than in the order the remote declares them.
  
  The order now comes from the catalog ordinal on all three dialects — `information_schema.COLUMNS.ORDINAL_POSITION` (MySQL), `information_schema.columns.ordinal_position` (Postgres), `PRAGMA table_info`'s `cid` (SQLite) — while `columnInfo()` remains the source of the per-column facts (`type`, `nullable`, `defaultValue`, `maxLength`), which knex already normalises per dialect.
- 46cfa5b: **Bug fix:** on Postgres, index and schema introspection now resolve tables the way the session does, instead of assuming the `public` schema (#9350).
  
  `introspectIndexes` pinned `n.nspname = 'public'` and `introspectSchema` pinned `table_schema = 'public'`. For a driver whose connection carries a `searchPath` pointing anywhere else, both returned **empty** — not an error, an empty result. Measured on a live Postgres 16: for a table carrying a primary key *and* a declared unique index, `introspectIndexes` returned `[]` and `introspectSchema` listed no tables at all.
  
  Empty does not read as "I could not see" downstream; it reads as "there are no indexes". `assertConflictTargetHonoured` turns that into a refusal, so an `upsert` against a perfectly well-indexed table would be rejected with *no PRIMARY KEY or UNIQUE index backs them* — and index-drift detection would propose creating indexes that already exist.
  
  - `introspectIndexes` now resolves the table with `to_regclass(?)` and reads `pg_index` by OID. That is the same resolution every other statement in the session performs — first match along `search_path` — and it removes an ambiguity a schema list would introduce, since two schemas on the path can hold the same table name and only one of them is the one a query reaches.
  - `introspectSchema` now lists `table_schema = ANY (current_schemas(false))`.
  
  **No change for a default deployment.** With the default `search_path`, `current_schemas(false)` is exactly `{public}` and `to_regclass` resolves into `public`, so both queries return what they returned before. The behaviour only differs where the old queries returned nothing.
- 479fba5: fix(driver-sql): `updated_at` is stamped on a deployment that never runs the driver's DDL (#11067)
  
  `SqlDriver.update()` refreshed `updated_at` only for tables in
  `tablesWithTimestamps`, and every one of that set's **four** fill sites is
  downstream of DDL: `initObjects`' `createTable` branch, its "the existing table
  already has an `updated_at` column" branch (decided from a physical
  `columnInfo()`), its rotation branch, and `aliasShardBookkeeping`'s
  rotation-shard copy. (The card reported three; the rotation branch inside
  `initObjects` is the fourth.)
  
  So a deployment that manages DDL out-of-band — `skipSchemaSync` /
  `OS_SKIP_SCHEMA_SYNC=1`, documented in
  `content/docs/deployment/environment-variables.mdx` as "skip the implicit
  `db:sync` on boot; use after running migrations manually" — booted with that set
  empty and never stamped. The column carries only an INSERT-time `DEFAULT now()`,
  with no `ON UPDATE` clause or trigger on any dialect, so `updated_at` recorded
  the row's **creation** time forever. Nothing errored: list-view sorts, delta and
  incremental sync, cache invalidation and audit answers were simply wrong.
  Measured before the fix on SQLite, live Postgres 16.13 and live MySQL 8.0.46 —
  a row backdated to `2020-01-01T00:00:00Z` and then updated through the driver
  came back still reading `2020-01-01T00:00:00Z` on all three.
  
  The fix is a pair, and the second half is what keeps it a bug fix rather than a
  contract change.
  
  1. **Inferred from the declared shape, at registration time.**
     `registerObjectMetadata()` — the DDL-free entry point a `skipSchemaSync` boot
     already calls — now records that a managed object's table is *expected* to
     carry `updated_at`, because every table this driver's own DDL creates gets
     `created_at`/`updated_at` unconditionally. That costs **zero round trips**,
     which is the currency `skipSchemaSync` exists to save. It is kept in a new
     `updatedAtColumnState` map rather than in `tablesWithTimestamps`, because it
     is an inference and that set means "observed".
  
  2. **A lazy, one-shot fallback for the table where the inference is wrong.** On
     a hand-migrated table that genuinely lacks the column, (1) alone would turn an
     `update()` that succeeds today into a loud failure — a *new rejection for a
     call that works*. Instead, the first stamped UPDATE to such a table is
     speculative: if it fails, the driver asks the database (`columnInfo()`)
     whether `updated_at` is really absent, and only then re-issues the caller's
     own statement without the stamp, logging a warning naming the divergence. Any
     other failure rethrows the **original** error untouched. Deliberately not
     keyed to the dialect's error text: the three dialects spell it three ways
     (`42703`, `ER_BAD_FIELD_ERROR`, `no such column`), and those strings are
     version-dependent.
  
  Steady state is free in both directions. A successful stamped UPDATE proves the
  column exists — a column named in a `SET` list that is not there is a parse/plan
  error on every dialect here, whatever the row count — so one success settles the
  table permanently; a resolved absence is cached and never re-probed. Tables the
  driver's DDL built were already in `tablesWithTimestamps` and never enter the
  speculative state at all, so the DDL path is byte-for-byte unchanged.
  
  When the caller has a transaction open, the speculative write is fenced in a
  knex nested transaction (a `SAVEPOINT`) via the existing
  `attemptWithoutPoisoning` — on Postgres any statement error aborts the whole
  transaction (`25P02`), so an unfenced `try/catch` whose recovery issues SQL on
  that transaction could never run there (#8269).
  
  Two narrowings, both deliberate:
  
  - **The insert path is untouched.** `stampInsertTimestamps` writes `created_at`
    as well, and none of the evidence above says anything about `created_at`, so
    it keeps reading `tablesWithTimestamps` exactly as before.
  - **Federated/external objects are untouched.** `registerExternalObject` does
    not route through managed registration, so a remote table is never presumed to
    carry audit columns.
  
  Pinned by `sql-driver-timestamps-without-ddl.test.ts`, which runs the card's
  repro sketch plus the missing-column leg, the round-trip budget, the
  caller-transaction leg and an unrelated-failure leg across SQLite **and** live
  Postgres / MySQL through `declareDialectCell`, so an unprovisioned dialect is
  reported rather than omitted.
- 927ccbb: fix(driver-sql): `introspectPrimaryKeys` returns the Postgres and MySQL composite key in DECLARED KEY ORDER (#11101)
  
  `SqlDriver.introspectPrimaryKeys` ordered its result on exactly one of its three
  dialect arms. #10997 repaired SQLite (completeness *and* key ordering, by sorting
  on the `PRAGMA table_info` ordinal); the Postgres and MySQL arms returned the key
  in unspecified row order.
  
  - **Postgres**: `a.attnum = ANY(i.indkey)` is a *membership* test. `i.indkey` is
    an `int2vector` holding the key's attnums **in key order**, but `ANY()` reads
    the vector as a set and discards the position, and the query carried no
    `ORDER BY`. It now joins the **ordinality** of `indkey`
    (`unnest(i.indkey) WITH ORDINALITY`) and orders by that ordinal.
  - **MySQL**: `KEY_COLUMN_USAGE.ORDINAL_POSITION` *is* the key ordinal and was
    selected by neither the projection nor an order clause. It now carries
    `ORDER BY ORDINAL_POSITION`.
  
  Both arms were measured returning **column order** — the key reversed — against
  live servers before the fix: PostgreSQL 16.13 and MySQL 8.0.46, on a table
  declared `(carrier_code, shipment_id, leg_seq)` with
  `PRIMARY KEY (shipment_id, carrier_code)`. The MySQL result is worth naming
  explicitly, because the received wisdom is the opposite: InnoDB did **not**
  return ordinal order for an out-of-sequence key.
  
  Why the order is load-bearing rather than cosmetic: `primaryKeys` is consumed as
  an **addressing / upsert-conflict-target** key — federated-object codegen, the
  persisted `external_catalog` under ADR-0015, and schema-drift comparison against
  a declared key. For those consumers a key in the wrong order is a *different*
  key. Until now the same table introspected through different dialects could
  disagree, since SQLite reported declared key order and the other two did not; all
  three now agree.
  
  Covered by `sql-driver-primary-key-order-dialects.test.ts`, which runs the same
  DDL on all three dialects and asserts the exact ordered array. Its live Postgres
  and MySQL cells execute in the `Temporal Conformance (live PG + MySQL)` CI job
  (a required check) and are reported as named skips elsewhere.
- a037f7c: Fix JSON-field writes on Postgres deployments that manage DDL out-of-band
  (`skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`): a non-empty array and a bare
  string were rejected with a 500, and an empty array was **silently stored as an
  empty object** (#10995).
  
  The SQL driver does `JSON.stringify` a JSON field's value on every non-SQLite
  dialect — but only for fields listed in its per-object `jsonFields` registry,
  and that registry (like the boolean / numeric / date / datetime / time /
  auto_number registries and the tenant-isolation column) was filled **only** as
  the first step of a DDL call. A deployment that skips boot schema sync therefore
  served every write knowing nothing about its objects, and values reached
  node-postgres to be encoded by its per-type defaults:
  
  - an **object** became JSON text — accidentally correct;
  - an **array** became a Postgres ARRAY LITERAL (`{…}`) — `22P02 invalid input
    syntax for type json`, a 500 on every write;
  - **except `[]`**, whose array literal `{}` is valid JSON, so an empty array was
    accepted and stored as an empty **object** — corruption, not an error;
  - a **bare string** was passed raw (`x` is not JSON text, `"x"` is) — a 500,
    while a number survived because `42` already is valid JSON.
  
  SQLite never showed any of it: `formatInput` ends with a bind-safety net gated
  on that dialect, so the same empty registry is invisible there — which is why
  tenant environments on Turso/SQLite and the suites that run on them were blind
  to a defect live on every Postgres deployment.
  
  The registration is now separable from the DDL, on the ruling #7737/#10629
  already made for federated objects — that flag is about DDL, and a binding that
  is DDL-free must not ride on it:
  
  - `SqlDriver.registerObjectMetadata(objects)` installs a managed object's
    coercion metadata with no `CREATE TABLE`, no `ALTER TABLE`, no existence probe
    and no round-trip — the managed sibling of `registerExternalObject`, declared
    optional on `IDataDriver` so drivers that don't need it omit it;
  - a `skipSchemaSync` boot (and metadata reload) now takes that route instead of
    doing nothing, keeping the cold-start budget the flag exists to protect;
  - `initObjects` registers before the ADR-0015 DDL gate refuses, so objects on a
    datasource ObjectStack is only a guest in are encoded from their declared
    field types too. The refusal itself is unchanged.
- f59035c: SQLite introspection now reports every member of a composite primary key, in
  declared key order. `SqlDriver.introspectPrimaryKeys` filtered
  `PRAGMA table_info` rows on `row.pk === 1`, but SQLite does not report `pk` as
  a boolean — it is the column's **1-based position within the primary key**
  (`0` = not part of the key, `1` = first key column, `2` = second, and so on).
  The filter therefore kept only the first member of a composite key and silently
  dropped the rest.
  
  Measured on in-memory SQLite, table declared `primary key (order_id, line_no)`:
  
  | signal | reported | reports instead |
  | --- | --- | --- |
  | `table.primaryKeys` | `['order_id']` | `['order_id', 'line_no']` |
  | `column.isPrimary` for `line_no` | `false` | `true` |
  
  Both signals were wrong together and for the same reason: `introspectSchema`
  derives `col.isPrimary` from `primaryKeys`, so a consumer could not recover the
  dropped member by cross-checking the two. Fixing the list repairs the flag with
  it.
  
  The rows are now also ordered by the `pk` ordinal rather than taken in
  `table_info` row order (which is *column* order). The two differ whenever a key
  is declared out of column sequence — a table with columns
  `(carrier_code, shipment_id, leg_seq)` and `primary key (shipment_id,
  carrier_code)` now reports `['shipment_id', 'carrier_code']` — and
  `primaryKeys` is consumed as an addressing / upsert-conflict-target key, where
  the order is load-bearing.
  
  Consumers affected: the federated-object codegen and the persisted
  `external_catalog` (ADR-0015) recorded a partial addressing/upsert key, and
  schema-drift comparison against a declared composite key read as drift on the
  dropped member. `SqliteWasmDriver` and `TursoDriver` extend `SqlDriver` and
  override neither method, so they inherit the repair. The Postgres and MySQL
  arms did not have this defect and are unchanged.
- Updated dependencies [6936d07]
- Updated dependencies [59eb04d]
- Updated dependencies [9f05b7d]
- Updated dependencies [3b2af5e]
- Updated dependencies [7d2d112]
- Updated dependencies [5fa0d72]
- Updated dependencies [02b3b07]
- Updated dependencies [46d34ab]
- Updated dependencies [914c413]
- Updated dependencies [55809a0]
- Updated dependencies [ee2ff45]
- Updated dependencies [47cd3ec]
- Updated dependencies [52db1d1]
- Updated dependencies [5649efb]
- Updated dependencies [9d7d2de]
- Updated dependencies [c815c50]
- Updated dependencies [795ea05]
- Updated dependencies [2306a76]
- Updated dependencies [e5ea701]
- Updated dependencies [a40dcc1]
- Updated dependencies [def0d3e]
- Updated dependencies [8d0bb79]
- Updated dependencies [5acb58d]
- Updated dependencies [2e3cf95]
- Updated dependencies [4c93387]
- Updated dependencies [504c8d5]
- Updated dependencies [a037f7c]
- Updated dependencies [3ee8ddf]
- Updated dependencies [16cef97]
- Updated dependencies [a79bd35]
- Updated dependencies [6ceaa4b]
- Updated dependencies [15ea214]
- Updated dependencies [de19489]
- Updated dependencies [c684d00]
- Updated dependencies [923c424]
- Updated dependencies [1ec36b7]
- Updated dependencies [5f2e54c]
- Updated dependencies [189373b]
- Updated dependencies [35ad101]
- Updated dependencies [ceb33a9]
- Updated dependencies [73d9795]
- Updated dependencies [8012960]
- Updated dependencies [f34f56b]
- Updated dependencies [f399618]
- Updated dependencies [75e9301]
- Updated dependencies [2810695]
  - @objectstack/spec@17.2.0
  - @objectstack/core@17.2.0
  - @objectstack/types@17.2.0
  - @objectstack/observability@17.2.0

## 17.1.0

### Minor Changes

- 9c4d096: feat(driver-sql): MySQL joins the unresolvable-column predicate — the `INVALID_FILTER` refusal envelope AND the #3821 recoveries, full dialect parity (#8926)
  
  **BREAKING** accept-set change on a GA public data API — in both directions at
  once, on MySQL only — shipped as `minor` under the lockstep launch-window
  convention, like the #8790 change it completes.
  
  <!-- adr-0087: not-required (already-registered driver-sql-unresolvable-where-column-refused) MySQL joining the refusal is a reach extension of the migration #8790 registered one card earlier; the surface and the prescription are unchanged — name a column the object actually has, or run schema sync. The entry's dialect-reach paragraph is amended in a follow-up spec PR, filed from #8926 -->
  
  ## What changes, on MySQL only
  
  `isUnresolvableColumnError` — the ONE predicate `SqlDriver.findRows()`'s #3821
  recovery ladder and `SqlDriver.count()` both read — now recognises MySQL's
  spelling of "the statement named a column the backend could not resolve":
  `Unknown column 'x' in 'where clause'` / `'field list'` / `'order clause'`
  (`ER_BAD_FIELD_ERROR`). SQLite and Postgres behaviour is untouched.
  
  Measured on live MySQL 8.0.46 (`SqlDriver` over mysql2), before → after:
  
  - **WHERE** — `find()` and `count()` alike: raw `ER_BAD_FIELD_ERROR`, no
    `status` (an unclassified 5xx at the REST boundary), the statement's bound
    literals inlined in the message → refused with `INVALID_FILTER` / 400 naming
    the column; the dialect message goes to the server log. The narrowing — the
    #7929 predicate-text disclosure shape closed on the last dialect that still
    had it.
  - **Projection** — `find({ fields: [...] })` naming a column the table lacks
    threw the raw error → retries selecting `*`; the rows come back, WHERE
    honoured. The widening.
  - **ORDER BY** — sorting by a column the table lacks threw the raw error →
    drops the sort and returns the rows unordered, WHERE honoured. The widening.
  
  Both directions were ruled together on #8926 (option A, maintainer,
  2026-08-16); a split predicate — the envelope without the recoveries — was
  refused. The widening cannot drop a predicate: every ladder rung is rebuilt
  from `buildBase()`, which unconditionally re-applies `query.where`, so the
  recoveries reach the projection and the sort only.
  
  ## Migration
  
  Nothing stored needs rewriting. A MySQL caller that relied on catching the raw
  `ER_BAD_FIELD_ERROR` from `find()`/`count()` should catch `INVALID_FILTER` /
  400 instead — the same envelope SQLite and Postgres already answer, and the
  same prescription the registered
  `driver-sql-unresolvable-where-column-refused` migration carries.
- 716ac9b: fix(driver-sql): one unresolvable WHERE column, one answer — `find()` and `count()` both refuse with `INVALID_FILTER` / 400 naming the column (#8790)
  
  **BREAKING** accept-set narrowing on a GA public data API, shipped as `minor`
  under the lockstep launch-window convention. The migration prescription is
  registered under protocol major 18, where `os migrate meta` users will look.
  
  <!-- adr-0087: registered driver-sql-unresolvable-where-column-refused -->
  
  ## The defect
  
  One predicate had two answers. `SqlDriver.findRows()` carries the #3821
  unknown-column recovery ladder, and every rung of it is built from
  `buildBase()`, which **always re-applies `query.where`**. So the ladder can drop
  a projection and can drop an ORDER BY, but it can never drop the clause that
  actually failed when the unresolvable column is in the WHERE — both rungs raise
  the same error and the method fell to `return []`. `SqlDriver.count()` runs a
  separate statement and has no ladder at all, so the identical predicate threw.
  
  Measured on a real `SqlDriver` over better-sqlite3, one table, one seeded row:
  
  ```
  where { 'title.x': 'y' }
    find()   ->  0 rows, NO ERROR
    count()  ->  THREW  code=SQLITE_ERROR  status=undefined
                 select count(*) as `count` from `task` where `title`.`x` = 'y'
                   - no such column: title.x
  
  CONTROL  where { title: 'Design' }
    find()   ->  1 row
    count()  ->  1
  ```
  
  A list view calls both halves, so one query produced an empty page from the rows
  half and a 500-shaped failure from the total half. A caller reading only the rows
  got a silent empty page that says "no records exist" for what was really "your
  predicate never ran" — the single most AI-legible failure to get wrong, since an
  agent reads "no matching records" and writes its next query on that belief.
  
  The thrown half was no better: the dialect's own `code`, no `status` (so an
  unclassified 5xx at the REST boundary rather than a caller mistake), and the
  statement's **bound literals inlined in the message** — the same predicate-text
  disclosure shape #7929 redacted elsewhere.
  
  ## The fix
  
  Ruled 2026-08-15 on #8790: **refuse both halves** with `INVALID_FILTER` / 400,
  naming the column. That envelope is not minted here — it is what every sibling
  refusal on this path already answers, required on both SQL drivers by
  `cross-field-conformance-cases.ts` and pinned by
  `sql-driver-boolean-identity.test.ts` and
  `sql-driver-cross-field-conformance.test.ts`. What closes is a
  declared-vs-enforced gap, not a new posture.
  
  The caller-visible message names the column and the object and nothing else. The
  dialect's own message — the compiled statement, bound literals and all — goes to
  the **server log** instead, so the operator keeps the debugging aid that
  `count()`'s raw throw used to provide without it reaching the caller.
  
  **The #3821 ladder keeps both of its recoveries.** Only the WHERE-failure
  terminal `return []` became a refusal, and the asymmetry is the ruling rather
  than an oversight: "rows matter more than their order" is an argument about how
  rows are *presented*, and it does not transfer to a predicate. A dropped sort is
  a correct answer in an unhelpful order; a dropped WHERE is records the caller
  explicitly excluded. Recover-both was rejected for exactly that reason.
  
  ## Reach, stated rather than assumed
  
  The refusal fires on the wordings the ladder has always recognised — SQLite
  (`no such column: x`) and Postgres (`column "x" does not exist`). MySQL spells
  the condition `Unknown column 'x' in 'where clause'`, which neither arm matches,
  so on MySQL an unresolvable column still travels out as the raw dialect error.
  That gap is pinned as a fact in the new suite and filed separately: widening the
  predicate would also hand MySQL the #3821 projection and ORDER-BY recoveries it
  has never had, which is an accept-set change in the opposite direction from this
  one.
  
  ## Who is affected
  
  Callers that reach the driver with a filter key the table has no column for. The
  ingress doors already refuse this where they can judge — `assertFilterFieldsExist`
  (`@objectstack/metadata-protocol`) answers `INVALID_FIELD` / 400 for everything
  reaching `findData`, with the sentence this refusal now echoes verbatim: *a
  filter on a field that does not exist can only match zero records, so the query
  was refused instead of answered with an empty list*. What changes is the
  backstop underneath them: a registry the door could not read, and a dotted key
  judged on its head segment only.
- c8806ae: fix(driver-sql): MySQL refuses an upsert whose `conflictKeys` no PRIMARY KEY or UNIQUE index backs — calls that previously "resolved" now throw (#8621)
  
  **This narrows MySQL's accept set.** A `SqlDriver.upsert(object, data, conflictKeys)`
  call on MySQL whose conflict target is backed by no PRIMARY KEY and no UNIQUE
  index used to resolve; it now throws `VALIDATION_ERROR` / 400. That is why this
  is a `minor` and not a patch: code that ran without error against MySQL will
  start failing, deliberately, and the rows it was writing were not the rows the
  caller asked for.
  
  SQLite and Postgres have refused this exact call since #8445 / #8567, with this
  exact sentence. MySQL did not, and could not: knex compiles
  `onConflict([...]).merge(...)` on `mysql2` to `ON DUPLICATE KEY UPDATE`, which
  takes **no conflict target at all**, so the named keys are dropped before the
  statement leaves the process and the server is never asked to find an index for
  them. The existing refusal classifies an error the server raised, so on MySQL it
  had nothing to classify.
  
  Measured on live MySQL 8.0.46 — `email` is the column the caller names, `tax_id`
  carries the only unique index:
  
  ```
  seed  upsert({email:'a@b.com',     tax_id:'T-1', title:'first'},  ['email'])  -> resolved
  B     upsert({email:'other@b.com', tax_id:'T-1', title:'second'}, ['email'])  -> resolved
          ONE row: merged on `tax_id`, which the caller never named, across two
          different `email` values.
  D     seed, then upsert({email:'a@b.com', tax_id:'T-2'}, ['email'])           -> resolved
          TWO rows, both `email='a@b.com'`: the merge that WAS asked for did not
          happen either.
  ```
  
  So the failure being replaced is not an illegible error — it is a silent wrong
  write. `upsert` now consults the table's physical keys before compiling on MySQL
  and answers the wording, `code` and `status` the other two dialects already
  answer (#5240 — one condition, one wording).
  
  **What this means for an existing MySQL deployment.** The calls that change are
  exactly those naming a conflict target no key covers — the same calls that have
  always been errors on SQLite and Postgres. The most likely one to surface is a
  tenant-scoped `unique: true` field: its index materializes as the composite
  `(COALESCE(organization_id, '__global__'), field)` (ADR-0120 D3), so
  `conflictKeys: ['field']` alone is not backed by it. The remedy is the one the
  refusal already prints: declare the column(s) `unique: true` and re-run schema
  sync, name the full composite, or upsert on the primary key.
  
  Deliberately unchanged:
  
  - **SQLite and Postgres.** They already refuse this from the server, and they
    attach the server's own sentence as `cause` — ground truth a pre-flight cannot
    reconstruct. Running the pre-flight there would replace a planner verdict with
    an introspection verdict for no gain.
  - **The default `['id']` path.** The pre-flight runs only when the caller names
    a target; the default is this driver's own primary key on every table it
    creates, so probing it would add a round trip to every ordinary upsert to
    answer a question with only one possible answer.
  - **Anything the pre-flight cannot prove.** A failed introspection, a table
    reporting no keys at all (indistinguishable from a table that does not exist),
    and a possibly stale cache all proceed rather than refuse — the cache is
    re-read from the database before any refusal is thrown.
  
  **Not fixed here, and filed as #8755:** `ON DUPLICATE KEY UPDATE` carries no
  conflict target even when the named one IS backed, so on MySQL a second unique
  index can still absorb the conflict and merge on a key the caller never named.
  This change closes the unbacked-target hole; it does not make MySQL honour
  `conflictKeys` as a target.
- bb96297: fix(driver-sql): refuse a MySQL upsert whose named conflict target another UNIQUE key can absorb (#8755)
  
  `ON DUPLICATE KEY UPDATE` — the only merge statement MySQL compiles — carries no
  conflict target, so the merge lands on whichever UNIQUE key the row collides with
  first. `#8621` closed the half where nothing backed the named target; this closes
  the half where the target IS backed and a *second* UNIQUE key absorbs the
  conflict instead.
  
  Measured on live MySQL 8.0.46, `email` and `tax_id` both `unique: true`, the
  caller naming `email`: the second upsert merged on `tax_id`, across two different
  values of the named key, leaving one row and no error. The identical call on
  SQLite and PostgreSQL raises `UNIQUE constraint failed: …tax_id` and leaves the
  seeded row untouched.
  
  **Accept-set change, MySQL only.** An `upsert(object, data, conflictKeys)` naming
  a non-primary target on a table that carries any other UNIQUE key is now refused
  before the statement is compiled — `code: 'VALIDATION_ERROR'`, `status: 400`,
  nothing written and no auto-number reserved. The message names the colliding
  index and both workarounds: drop or rename the extra UNIQUE key, or run the
  object on a dialect that honours the target.
  
  Deliberately unchanged: a table whose only UNIQUE key IS the conflict target (the
  common shape) merges exactly as before, as do the `conflictKeys`-less default and
  an explicitly named primary key. The MySQL dialect limit and that residue are
  documented under *Database Drivers → MySQL*.
- d00d2f6: fix(driver-sql): refuse — and roll back — a MySQL upsert that merges onto a row the caller never identified (#8807)
  
  `ON DUPLICATE KEY UPDATE` carries no conflict target, so on MySQL a merge lands on
  whichever UNIQUE key the row collides with first. `#8621` closed the half where
  nothing backed a caller-named target; `#8755` closed the half where a rival key
  could absorb a caller-named one. This closes the residue those two left by
  construction: the `conflictKeys`-less call and the `['id']` call, which compile
  byte-identically and which no pre-flight can judge, because neither names anything.
  
  Measured on live MySQL 8.0.46, `email` and `tax_id` both `unique: true`, **no**
  `conflictKeys`: seeding `{email:'d@b.com', tax_id:'T-9'}` inserted one row, and
  `{email:'e@b.com', tax_id:'T-9'}` then resolved with no error — one row, the
  *seeded* one, its `email` rewritten `d@b.com` to `e@b.com`, and the id the caller
  was handed back present in no row at all. The identical pair on SQLite raises
  `UNIQUE constraint failed: …tax_id` and leaves the seeded row untouched.
  
  Per the maintainer ruling on #8807 this enforces a contract principle, not a MySQL
  detail: *an `upsert` must never modify a row whose identity the caller did not
  supply and whose conflict key it did not name.*
  
  **Accept-set change, MySQL only.** After the statement and inside the same
  transaction, the driver checks whether the row it landed on is the one the call
  supplied. If it is not, the write is **rolled back** and the call refuses with
  `code: 'VALIDATION_ERROR'`, `status: 400`, naming the UNIQUE key that absorbed the
  merge and stating that nothing was changed.
  
  The check is exact rather than heuristic — `id` is insert-only on the merge path
  (#8622), so a row merged on the primary key always still carries the supplied id
  and a row merged on any other key never does — which is why it has no false
  refusals.
  
  Deliberately unchanged: tables whose only key is the primary key are not verified
  and open no transaction, so the ordinary upsert keeps its single round trip; every
  insert and every re-upsert of the same row still merges; the caller-named
  single-unique-key fast path is untouched; and SQLite and PostgreSQL are unaffected,
  because `ON CONFLICT (...)` already honours the named arbiter. The lifecycle
  archiver's hot→cold copy passes by construction — it supplies each row's own id —
  and of the two objects declaring `lifecycle.archive`, neither carries a
  non-primary unique field. The dialect limit is documented under
  *Database Drivers → MySQL*.

### Patch Changes

- 8bbf459: fix(driver-sql): boot schema-sync's MySQL widening ALTER bounds its metadata-lock wait too — a blocked boot warns and carries on instead of hanging for a year (#9542)
  
  #9354 bounded `lock_wait_timeout` to 120s on the widening `ALTER TABLE … MODIFY
  COLUMN` and made a blocked `os migrate apply` refuse loudly — but only while
  `flushDeferredSchemaDdl` was running. The same two widenings
  (`migrateMysqlDatetimeColumns` / `migrateMysqlTimeColumns`, #3942 / #3994) are
  reached from **boot schema-sync** through the same `initObjects` lines, and on
  that path the `runWideningAlters` seam returned early: the ALTER ran through the
  pool inheriting MySQL's own default `lock_wait_timeout` of **31,536,000 seconds
  — one year**.
  
  So a single other session holding a metadata lock on the table parked boot at
  schema-sync for that long, printing nothing — indistinguishable from a crash.
  The widening's own `logger.warn` could not help, because it lives in a `catch`
  and an ALTER that never returns is never caught.
  
  The bound is now armed **unconditionally** in that seam. What stays gated on the
  flush is the **refusal**, and only it: boot still swallows. Correctness never
  depends on the widening having run and a migration must never take boot down, so
  throwing there would trade a silent hang for a failed boot — a different answer,
  not the same one.
  
  **What changes for a deployment.** On MySQL, a boot whose widening ALTER is
  blocked on a metadata lock now waits at most 120s, then logs
  `[sql-driver] could not widen MySQL datetime columns on …` (or its `TIME(3)`
  twin) naming the table, with the server's own `Lock wait timeout exceeded` as
  the `error` field — and boot carries on. The widening is idempotent, so the
  first boot after the blocker is gone completes it. Nothing changes on any other
  dialect, on an ALTER that is not blocked, or for `os migrate apply`, which keeps
  #9354's `DATABASE_ERROR` / 500 refusal.
  
  120s is #9354's number, kept for boot deliberately rather than lengthened: the
  reasoning behind it is about how long a legitimate metadata-lock holder can
  plausibly hold the lock, which is a property of the lock and not of who is
  waiting on it. Boot's difference from the flush is what happens when the bound
  fires, never how long it waits. No retry logic and no configurability — the
  2026-08-17 ruling's minimality, unchanged.
- 2c570f3: fix(driver-sql): a blocked `os migrate` now refuses in 120s instead of hanging for a year on a MySQL metadata lock (#9354)
  
  The deferred-DDL flush widens legacy MySQL `TIMESTAMP` columns to `DATETIME(3)`
  and `TIME` to `TIME(3)` with `ALTER TABLE … MODIFY COLUMN`, which needs an
  **exclusive metadata lock** on the table. That ALTER ran on a session inheriting
  MySQL's default `lock_wait_timeout` — **31,536,000 seconds, one year**. A single
  other session holding a lock on the table (a long-running transaction, an open
  uncommitted session, a stuck report query) parked the ALTER in
  `Waiting for table metadata lock` for that long, and nothing printed.
  
  An operator running `os migrate apply` against a busy production table met this
  as a command that simply hangs — indistinguishable from a crash, with no output
  to diagnose from. It was first measured as a CI stall: a sub-second test blew a
  5000ms budget with **no error at all**, because the ALTER just sat in a lock wait
  until vitest killed the process.
  
  Two things were wrong, and a bound alone would have fixed neither:
  
  - **Nothing bounded the wait.** `lock_wait_timeout` had zero occurrences
    anywhere in `packages/`.
  - **The widening swallows its failures.** That policy is right on boot — a
    migration must never take boot down, and correctness never depended on the
    widening having run — but on the flush it means `os migrate apply` reports
    success for work it did not do.
  
  The flush now runs its widening ALTERs on **one pinned connection**, bounds
  `lock_wait_timeout` to **120 seconds** on that same session, and lets exactly one
  condition escape the swallow: a metadata-lock timeout is re-thrown as an ADR-0112
  envelope — `DATABASE_ERROR` / 500, from the existing closed vocabulary — whose
  message names the lock wait, the table, the bound it hit, and how to find the
  holder. `os migrate apply` prints that message and exits 1.
  
  The connection pinning is the load-bearing half: `lock_wait_timeout` is a SESSION
  variable, so a `SET SESSION` issued through the pool lands on a connection the
  ALTER never uses — a no-op that looks exactly like a fix.
  
  **120 seconds** is chosen as a diagnosis deadline, not a capacity knob: three
  orders of magnitude above the milliseconds a normal OLTP transaction holds a
  metadata lock (so an ordinary busy table never trips it), and still inside the
  window where the operator is watching the command. The widening is idempotent,
  so the cost of firing too eagerly is one re-run.
  
  Unchanged, deliberately: boot schema-sync still runs unbounded and still
  swallows; every non-lock-wait failure during the flush keeps the swallow it had.
  No retry logic and no configurability — both wait for measured demand.
- 7337f30: chore(deps): production-dependency patch bumps from the weekly Dependabot group (#9212)
  
  Routine dependency-range refresh, no behavior change: `@oclif/core` 4.13.2→4.13.3,
  `esbuild` 0.28.1→0.28.2 and `better-sqlite3` ^13.0.2→^13.0.3 (optional) on
  `@objectstack/cli`; `mingo` 7.2.2→7.2.4 on `@objectstack/driver-memory`; `nanoid`
  6.0.0→6.0.1 on `@objectstack/driver-mongodb`, `@objectstack/driver-sql`,
  `@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso`, plus
  `better-sqlite3` ^13.0.2→^13.0.3 (optional on `@objectstack/driver-sql`, peer on
  `@objectstack/driver-turso`); `js-yaml` 5.2.2→5.2.3 on `@objectstack/metadata`;
  `@noble/hashes` 2.2.0→2.3.0 and `jose` 6.2.5→6.2.8 on `@objectstack/plugin-auth`;
  `nodemailer` 9.0.3→9.0.5 on `@objectstack/plugin-email`; `@hono/node-server`
  2.0.12→2.1.1 and `hono` 4.12.34→4.13.2 on `@objectstack/plugin-hono-server`;
  `pinyin-pro` 3.28.2→3.29.1 on `@objectstack/plugin-pinyin-search`; and
  `@noble/ciphers` 2.2.0→2.3.0 on `@objectstack/service-settings`.
  
  Every entry above changed a `dependencies`, `optionalDependencies` or
  `peerDependencies` range in the published manifest — the only kind of change
  that reaches a consumer's install. The same Dependabot group also bumped
  `devDependencies` on `@objectstack/hono`, `@objectstack/client`,
  `@objectstack/core`, `@objectstack/plugin-sharing` and `@objectstack/spec`
  (none consumer-facing), and touched the private `apps/docs`,
  `examples/app-todo` and workspace-root manifests (none published) — none of
  those get an entry here.
- cbf4b40: fix(driver-sql): a dialect error the driver cannot attribute leaves the read exits as an ADR-0112 backend-fault envelope instead of raw (#8931)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  added, renamed, retired or tombstoned — no metadata key, no spec surface, no
  declaration an author writes. The change is entirely in what a failing READ
  throws: an error that already declared no `status` and carried the compiled
  statement now declares `DATABASE_ERROR` / 500 and does not. There is no source
  file for a consumer to migrate and therefore no semantic-migration TODO to
  emit; the accept set is unchanged, since every condition below failed before
  this change and fails after it. -->
  
  `SqlDriver.find()` / `findOne()` / `count()` had one exit that answered with the
  **database's own error object**: a `code` from the backend's vocabulary
  (`42P01`, `SQLITE_ERROR`, `42601`, `22P02`, …), **no `status`** at all, and a
  message opening with the compiled statement. Two things travelled out of it that
  should not have — the statement's shape, and on one measured row the caller's
  own value.
  
  Ruled 2026-08-17 on #8931: the driver stops answering an unenveloped dialect
  error. Any dialect error the existing classification does not claim now leaves
  as a **generic backend-fault envelope**, `DATABASE_ERROR` / 500, asserting only
  *"the backend rejected this statement"*.
  
  **Not a filter verdict, and that is the ruling rather than a preference.**
  Measured live on PostgreSQL 16.13, a dotted WHERE key and a table that was never
  created raise the *same* SQLSTATE:
  
  ```
  dotted key        42P01  missing FROM-clause entry for table "title"
  table not created 42P01  relation "no_such_object" does not exist
  ```
  
  An `INVALID_FILTER` here would tell an operator whose schema sync had not run
  that their *filter* was wrong. The signal cannot support the claim, so the
  envelope does not make it — and the driver still never inspects the caller's key
  for a `.` (that verdict is #8371's, and it landed there).
  
  **Mechanism: a terminal catch-all, not a new recognizer.** No predicate learns
  `42P01`. `isUnresolvableColumnError` and `isMissingTableError` are untouched, so
  the #8790 refusal (`INVALID_FILTER` / 400 naming the column) still wins wherever
  it applies, and the #3821 projection / ORDER-BY recoveries still return rows.
  
  **What now takes the envelope**, measured on live PG 16.13 and better-sqlite3:
  a table that was never provisioned; a dotted WHERE key on Postgres; a
  comparand-shape syntax fault; a value the column type rejects; and connection,
  pool-acquisition, timeout or permission failures.
  
  **The disclosure this closes on a route nobody had named.** Postgres puts the
  caller's rejected VALUE in its own `22P02` diagnostic (`invalid input syntax for
  type integer: "…"`), *downstream* of everything knex parameterised — so no
  statement cut removes it. Withholding the dialect text whole is what closes it.
  (#8931's headline premise, a bound literal inlined on the *dotted* route, was
  measured false and pinned by #9108; this is the neighbouring row where a value
  really does travel.)
  
  **The original error is kept as a non-enumerable `cause`.** That is load-bearing,
  not tidiness: `isMissingTableError` follows `cause`, and thirteen read paths use
  it to tell "the table was never provisioned" — a benign emptiness — from a
  failure that must stay loud. Non-enumerable so the statement cannot ride back
  out through `JSON.stringify(err)` or a spread.
  
  **For callers.** At the REST boundary the wire answer for these conditions is
  materially unchanged — `mapDataError` already derived `500` + `DATABASE_ERROR`
  for them by sniffing the message; it is now *declared* by the producer that
  knows, per ADR-0112, and every non-REST consumer (an in-process ObjectQL caller,
  a plugin, an AI-authored action) gets the same declared answer instead of having
  to pattern-match a SQLSTATE that differs per backend. Two consequences worth
  naming: code that matched on the raw dialect `code` or message of a failing
  **read** must read `error.cause` instead; and a read against a **registered
  object whose table was never created** now answers `500 DATABASE_ERROR` where it
  previously answered `404 OBJECT_NOT_FOUND` with the body `Object 'x' is not
  registered` — a sentence that was false in exactly that state.
- 86431f7: docs(driver-sql): rewrite the published README to the shipped driver surface (#9867)
  
  `packages/drivers/driver-sql/README.md` is in the package's `files` array with
  `private` unset, so it is the page npm renders. It told the reader to build a
  stack with a static factory on a class that is not exported, at three call sites:
  
  ```ts
  driver: DriverSQL.configure(getDatabaseConfig())
  ```
  
  Measured against the built `dist/index.d.ts`: `DriverSQL` occurs **zero** times,
  and no `configure` static exists on `SqlDriver` or on anything else the package
  exports. `DriverSQL.configure()` was never real — the commit that first repaired
  these snippets elsewhere in the same file (2026-05-07) called it "the imaginary
  `.configure(...)` static factory", and it fixed only the Basic Usage section, so
  the page has contradicted itself since: correct `SqlDriver` import at line 43,
  fabricated `DriverSQL` at 448/482/516. The receiver is a free identifier that
  imports nothing, which is why `check:published-readme-exports` — both halves of
  which key on an *imported* name — could not see it.
  
  Renaming would not have produced working code, and the sweep this card asked for
  found the surrounding shape was fabricated too. Every claim on the page was
  re-measured; the ones that were wrong:
  
  - **`defineStack({ driver: … })` does not exist** — the six `driver:` call sites
    (three `new SqlDriver(...)`, three `DriverSQL.configure(...)`) all named a key
    `ObjectStackDefinitionSchema` never declared. Since #8687 that schema is
    `.strict()`, so it does not merely drop the key: `defineStack` **throws**
    (`Unrecognized key(s) on this stack definition: 'driver'`), and `tsc` refuses
    the literal with `TS2353`. A driver is a plugin —
    `plugins: [new DriverPlugin(new SqlDriver({ … }))]`, `DriverPlugin` from
    `@objectstack/runtime`. The env-var route (`OS_DATABASE_URL`) is documented
    alongside it.
  - **Four of the six documented driver methods do not exist.** `driver.raw()` (six
    call sites) is `execute()`; `checkConnection()` (two) is `checkHealth()`, which
    resolves `false` rather than throwing, so the try/catch example was wrong in
    shape as well as in name; `destroy()` is `disconnect()`; `transaction(cb)` is
    `beginTransaction()` + `options.transaction` + `commit()`/`rollback()`, and the
    callback's `trx.insert({ object, data })` names nothing at all. `getKnex()` was
    the only one that resolved.
  - **`kernel.getDriver()`** — three call sites; `ObjectKernel` has no such member
    (`getDriver` is *private* on the engine).
  - **The query AST was wrong in three places.** `find` takes the object name as
    its first argument, so `find({ object, … })` is an arity error; the filter key
    is `where` with the ObjectQL dialect (`{ amount: { $gte: 10000 } }`), not
    `filters: [{ field, operator, value }]`; and sorting is
    `orderBy: [{ field, order }]` — `sort`/`direction` is the spelling
    `SortNodeSchema` lists as a retired alias.
  - **The config type name was wrong.** The page declared
    `interface SQLDriverConfig`; the export is `SqlDriverConfig`
    (`TS2724 … Did you mean 'SqlDriverConfig'?`), it is `Knex.Config` plus four
    ObjectStack keys, and all four — `schemaMode`, `autoMigrate`,
    `sqliteJournalMode`, `sqliteAbsentFile` — were undocumented.
  - **A config block that could not load.** The tenant-field example wrote
    `tenancy: { enabled: true, strategy: 'shared', … }`; `tenancy.strategy` was
    removed after spec 15.0 (#2763) and is now a tombstone that rejects with a
    prescription.
  - **The environment-config example did not compile even setting the fabricated
    factory aside** — `configs[env]` with `env: string` is `TS7053`, and `ssl` sat
    at the top level of the config, where Knex does not read it (it belongs to
    `connection`).
  - **Every raw-SQL example queried tables that do not exist.** The physical table
    name *is* the namespace-prefixed object name (`crm_account`, `sys_user`);
    nothing is prefixed `objectstack_`.
  - **The Migrations section documented an off-platform workflow** — a `knexfile.js`
    plus `npx knex migrate:latest`. Schema is reconciled from object metadata
    (`schemaMode: 'managed'`, `autoMigrate`), reviewed with `os migrate plan` and
    applied with `os migrate apply`; indexes are declared on the object
    (`indexes: [{ fields, unique }]`), not issued as DDL. The "always use
    migrations, never raw DDL" best-practice line said the opposite of how the
    platform works.
  - **A dead import.** The Vercel example imported `createClient` from
    `@vercel/postgres` and never used it.
  
  All 19 TypeScript fences on the rewritten page are extracted verbatim and
  compiled against the built `.d.ts` files the `exports` maps resolve; the two
  `defineStack` shapes are additionally executed. Docs only — no runtime code
  changed and no API was added.
- a9df51c: fix(drivers): withhold the target field from a policy-authored `INVALID_FILTER` refusal (#8197)
  
  `#7929`/B stopped `driver-sql` echoing the operands of a cross-field
  `{ $field }` refusal, and `#8220` gave that withhold a spec-declared provenance
  mark so an author-written predicate gets its diagnostic back. Neither reached
  the rest of the `INVALID_FILTER` family: five other refusals still named the
  refused constraint's own **target column** to every caller.
  
  That column is not always the caller's. The security middleware ANDs an
  administrator's compiled CEL rule into `opCtx.ast.where`, and on such a
  predicate the target is as administrator-authored as the referent `#7929`
  already withholds — the argument that ruling accepted, one step out. The most
  reachable case is a permission rule over a `multiple: true` field, which lowers
  to a membership test on a JSON-stored column and is refused by `#7398`'s gate
  while naming the column the administrator wrote.
  
  Measured on a real `SqlDriver` (better-sqlite3, `:memory:`) through
  `driver.find`, all five answered `INVALID_FILTER` / 400 naming the target, and
  the author-marked spelling was byte-identical to the unmarked one — the mark
  reached these sites but was never consulted, because none of these builders
  passed through the withheld-refusal carrier.
  
  They now do. The five join the seam `#8220` already owns, with its fail
  direction unchanged:
  
  - the JSON-column operator gate (`#7398`),
  - the zero-operator field constraint (`#5240`),
  - the unbindable comparand (`#5041`) — which also answers a **malformed**
    `{ $field }`, one whose referent is not a string and so never reaches the
    cross-field arm,
  - the `$between` arity refusal,
  
  plus `driver-turso`'s copied `RemoteTransport.uncompilableComparand`, so one
  deployment does not disclose differently depending on its connection mode.
  `driver-sqlite-wasm` inherits `SqlDriver`'s compiler and needed no source
  change.
  
  **Who sees what.** A subtree positively marked `'author'` by a read-scope merge
  boundary keeps the whole diagnostic, target column included. Everything else —
  `'policy'`, unmarked, and ambiguous — receives the refusal's identity
  (`INVALID_FILTER` / 400), which class fired, and the capability statement and
  repair prescription with placeholder names; the naming half goes to the server
  log. Unmarked withholds by design: the mark is permission to reveal, never a
  requirement to prove secrecy, and any design where a missing mark lands on the
  disclosing branch re-opens `#7929`.
  
  **The accepted cost, stated rather than hidden.** The author-vouch surface is
  two call sites, and `plugin-security`'s is conditional on `ast.where` still
  being the caller's verbatim object — which fails once `plugin-sharing` has
  composed (`#8430`). Until that lands, an author on an object with active
  sharing rules loses the target-field name from these messages. That is
  fail-closed, and it is the price of the ruling rather than a defect.
  
  Redaction takes everything derived from the predicate — the target field, the
  operator, the comparand preview, the filter path — for the reason `#7929` gave
  when it withheld both operands rather than one: a comparand preview is the
  administrator's literal just as surely as a column name is, and half a
  redaction is none.
- ab8b10f: test(driver-sql): attribute each `legacyUniqueReplacements` guard to exactly one case (#8557)
  
  **`patch`, and deliberately not `none`.** This adds no runtime code and changes
  no behaviour — every assertion is green on `main` before the change. The bump is
  the floor rather than a skipped changeset because the file it protects is
  release-relevant: what lands is the pin that makes a future single-guard
  deletion visible, and the release notes for the version that first carries it
  are the place a maintainer looks to learn the pin exists. A `minor` would claim
  a capability; `none` would leave the protection undocumented at the only moment
  anyone reads for it.
  
  The declared-index replacement arm's guards were **individually unpinned**:
  measured on #8468, deleting the ADR-0120 S6 name-identity guard, or admitting a
  declared bare `unique: true` through the scope filter, left the entire suite
  green — including the two tests whose names say they cover exactly those cases.
  The protection was real but collective, so no test attributed it to a line, and
  a refactor could remove any single guard and be told nothing.
  
  `schema-drift.legacy-unique-guard-attribution.test.ts` adds that attribution.
  The existing object-level suites are untouched — they are broader than any one
  guard, which is why they could not do this job.
  
  - **Nine guards are individually attributable.** One input per guard,
    constructed so only that guard can reject it, each paired with a **twin** —
    the same input with the single property that guard reads changed, which must
    produce exactly one replacement. The twin is the reachability witness: without
    it a case would still pass while some earlier guard swallowed the input, which
    is the failure mode being fixed, one level up. Measured: deleting any one of
    the nine turns **exactly one** test red, and its name says which line went.
  - **Five guards cannot be attributed at all**, because another guard rejects a
    superset of their inputs — deleting one is behaviour-preserving for every
    possible argument, so a test claiming to pin it would be lying. For those,
    what is pinned is the **fact the domination rests on**, so the day it breaks
    and the guard becomes load-bearing alone, something goes red.
  
  Behind the dominated S6 guard are the hand-written organization composites on
  `sys_team`, `sys_business_unit` and `sys_member` — three shipped platform
  objects on a spelling valid indefinitely. Those composites are now pinned
  directly, in both the shipped bare-`true` spelling and the respelled
  `'organization'` form.
  
  The bare-spelling case is the test-side half of a pair whose first half already
  shipped: #8463 (PR #8512) put the same divergence into prose on
  `isOrganizationScopedUnique`'s JSDoc, in this same file, with no test attributing
  it. Routing the declared branch through the field predicate remains the rejected
  option 1 of #8323 (maintainer ruling 2026-08-13), and is now refused by a test
  rather than only by a comment.
- 3b3f67d: Report an un-run MySQL widening ALTER at `error`, naming the fix
  
  Boot schema-sync widens legacy MySQL `TIMESTAMP` columns to `DATETIME(3)` and
  zero-precision `TIME` columns to `TIME(3)`. When that DDL cannot run — most
  often another session holding the table's metadata lock — the failure is
  swallowed on purpose so a migration never takes boot down. It was reported at
  `warn`.
  
  That is the case AGENTS.md's degradation rule names for `error` by name: after
  the swallow the platform boots, serves traffic and looks entirely normal, while
  the DDL that was supposed to run did not. An un-widened `TIMESTAMP` keeps
  truncating milliseconds and an un-widened `TIME` keeps rounding fractional
  seconds to whole ones, against a canonical storage form that promises the
  milliseconds are kept, and nothing else reports the column as outstanding.
  
  Both lines now report at `error` and say what to do about it — identify the
  metadata-lock holder, end it, then re-run `os migrate apply` or restart, the
  widening being idempotent. Control flow is unchanged: the swallow stays, and
  the deferred-DDL flush keeps its loud refusal.
  
  `scripts/check-durability-degradation-log-level.mjs` gains `runWideningAlters`
  in its durability vocabulary, so the class stays fixed rather than these two
  sites.
- cd455c8: docs: four published READMEs stop documenting symbols and call sites that do not exist (#9544)
  
  All four packages ship `README.md` in their `files` array with `private` unset, so these
  are the pages npm renders. Each finding was re-measured against the **built `.d.ts`**, not
  against source, because that is what a consumer resolves through the `exports` map.
  
  - **`@objectstack/driver-sql`** — `import type { IDriver } from '@objectstack/spec'` named
    a type that exists **nowhere in the repository** (0 hits across every package's `src`
    and `dist`). The real contract is `IDataDriver` on `@objectstack/spec/contracts` — the
    one `SqlDriver` actually declares (`export class SqlDriver implements IDataDriver`). The
    adjacent operation list was corrected too: the method is `create`, not `insert`.
  
  - **`@objectstack/mcp`** — `DriverSql` has never existed (the export is `SqlDriver`), and
    the README then called `DriverSql.configure({...})` on it. Renaming alone would have
    been wrong twice over: `SqlDriver` has **no static `configure` either**, and `driver:`
    is not a key of `defineStack` at all. The example now declares a datasource the way the
    shipped templates do. `MCPServerPlugin.configure({...})` — five call sites — becomes
    `new MCPServerPlugin({...})`, the form the class's own JSDoc and every in-repo caller
    use. The documented options block claimed `serverName`, `autoRegisterTools`,
    `autoExposeObjects`, `enableStreaming`, `port` and `debug`; the real
    `MCPServerPluginOptions` is `name`, `version`, `transport`, `autoStart`, `instructions`,
    and the env switches are named instead.
  
  - **`@objectstack/objectql`** — `registerObject` is an **instance** method, so
    `SchemaRegistry.registerObject(...)` on the class could never run. The example now
    reaches it through the engine's registry and states the real parameter order
    (`schema, packageId, namespace?`).
  
  - **`@objectstack/spec`** — the protocol package's own front page imported
    `MCPServerConfigSchema` from `@objectstack/spec/ai`, which exports `MCPServerRefSchema`.
    A rename by itself would have swapped a broken import for a broken **parse**: the
    documented payload was built for a schema that does not exist, and
    `MCPServerRefSchema.safeParse` rejects it (`transport` is an enum of
    `stdio | http | websocket`, not an object, and `endpoint` is required and was absent).
    The example is now a payload that parses green, and the page says plainly that tools,
    resources and prompts are derived from metadata at runtime rather than authored there.
- a4acb8d: fix(driver-sql): a merge-path upsert stops rewriting the row's primary key (#8622)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable key is
  renamed, retired or tombstoned. The change is entirely inside
  `SqlDriver.upsert`'s merge-set construction: one column joins the existing
  insert-only exclusion set that `created_at` and `auto_number` are already in. -->
  
  `upsert(data, conflictKeys)` on a **business key** — the ordinary way to ingest
  external data — silently replaced the `id` of the row it merged into. Every
  relationship, audit record, external id mapping and client-held reference
  pointing at that row was left dangling, with no error raised on any dialect.
  
  Measured on a properly BACKED conflict target (`email` declared `unique: true`),
  so this was the supported path, not an error path:
  
  ```
  upsert({ email: 'x@b.com', title: 'first'  }, ['email'])
  upsert({ email: 'x@b.com', title: 'second' }, ['email'])
  
  [sqlite] before=[{id:'yMh3oywrp0Z6p-oJ', title:'first'}]
           after =[{id:'d8T8rUlTxlRlaUhN', title:'second'}]   idPreserved=false
  [pg]     before=[{id:'T3AlYiyDi5buzGvW', title:'first'}]
           after =[{id:'TvbCTa5mydWPYP76', title:'second'}]   idPreserved=false
  ```
  
  One row throughout, as intended — with a different primary key. `upsert` mints a
  nanoid for any call that supplies none, and `id` travelled in the merge set, so
  `… on conflict ("email") do update set …, "id" = excluded."id"` wrote the
  **losing** insert's fresh id over the winning row's. On the default `['id']`
  conflict target that clause is a no-op (both sides hold the same value), which is
  exactly why it stayed invisible for so long.
  
  `id` is now insert-only on the merge path, joining `created_at` and the
  `auto_number` columns (#7011) in `insertOnlyUpsertColumns` — the same exclusion
  argument at its strongest instance, since the primary key *is* the platform's row
  identity. It is resolved through `remoteColumn`, because a federated object can
  bind `id` to a differently-named physical column (ADR-0015 §18) and a literal
  `'id'` would filter nothing there.
  
  **The accept set is unchanged**: the same calls still succeed, still merge, and
  still advance `updated_at` and every other mergeable column — the merge simply
  stops rewriting row identity. Re-keying a row deliberately is still `update()`'s
  job, which writes exactly the columns it is handed.
  
  Measured on SQLite and live PostgreSQL 16.13. Live MySQL 8.0.46 measured the same
  rewrite in #8592 and its characterization pin is rewritten here to assert
  preservation; that cell had no server available in this container and runs first
  in CI's `Temporal Conformance (live PG + MySQL)` job.
- 682b86b: fix(objectql): a caller value containing " - " no longer eats the diagnostic's template head, and no longer leaves its own suffix in the log (#9275)
  
  `redactStatementFromMessage` cuts the bound statement off a driver error at the
  **last** ` - `, because a bound value may itself contain that separator and
  cutting at the first would leave a fragment of the value standing.
  
  When the value the DATABASE inlines into its own diagnostic also contains ` - `,
  that reasoning inverts: the last separator lands **inside the diagnostic's
  value**, so the cut discards the template head — the half that could not leak —
  and keeps a suffix of the caller's data, which is the half that does. Re-measured
  at HEAD on live PostgreSQL 16.13 with the canary
  `SENSITIVE-CANARY-9275 - 2026 - Q3`:
  
  ```
  raised:   insert into "t" ("age") values ($1)
              - invalid input syntax for type integer: "SENSITIVE-CANARY-9275 - 2026 - Q3"
  logged:   Q3" [statement and bound values redacted]
  ```
  
  `Q3` is the caller's data, at ERROR level, which is what this neighbourhood
  exists to prevent. Families with a right anchor (`for key …`,
  `for column … at row N`) already recovered through their `tail` pattern; the ones
  whose value runs to end of message had nothing to recover from.
  
  **The cut is now template-aware.** When a separator in the message stands
  immediately before a diagnostic head this file has measured, that separator is
  the true cut point whatever its position: the head survives and the value after
  it — separator and all — is dropped whole by the template that owns it. After
  the fix the same error logs
  `invalid input syntax for type integer: [value redacted] [statement and bound
  values redacted]`, so the operator keeps strictly more diagnostic than before.
  
  **Three families, not the two the card named.** `pg 22003` was left without a
  head-gone recovery on the reasoning that an out-of-range value is a number and a
  number cannot contain ` - `. Measured through the driver's own bind path, that is
  false — Postgres detects the overflow while scanning digits, *before* it rejects
  the trailing junk, so it echoes the caller's whole string:
  `insert({ age: '99999999999 - 2026 - Q3' })` logged `Q3` too. It keeps its right
  anchor, so it takes the #8823 anchor recovery rather than the new cut.
  
  The trade this takes deliberately, and its bound: matching a template before the
  cut lets a hostile value steer where the cut lands. That steering is bounded to
  **over-redaction, never exposure** — a template may declare a head only if its
  value runs to end of message, so a cut landing inside a statement is swallowed
  whole by that template; and the **last** matching head wins, so a value that
  mimics a head is cut at the mimic and cannot survive behind its own decoy. What a
  crafted value can do is suppress a real diagnostic; that cost is asserted by its
  own case rather than left to be discovered. The six identifier-bearing families
  the live probe pins are untouched — over-matching deletes the diagnostic an
  operator came for, and remains the expensive direction.
- 6a1b45e: fix(objectql): stop logging the caller's value for four MORE diagnostic families — measured off live MySQL 8.0 / PostgreSQL 16, not read off a manual (#9160)
  
  #8823 established that a database's diagnostic does not always name only
  IDENTIFIERS: MySQL's `ER_DUP_ENTRY` inlines the conflicting VALUE, and
  `redactStatementFromMessage` redacts that one slot while keeping the index name
  an operator needs.
  
  The list it introduced had **exactly one entry and no way to notice a second was
  missing**. Nothing measured whether a diagnostic a driver produced carried a
  value; the single entry got there because a human read one template closely, and
  the standing rule (`packages/types/src/unique-violation.ts`) — a dialect's
  spelling goes in once measured off a thrown error, never from a reading of the
  manual — correctly prevented the list from growing on a guess.
  
  **The instrument now exists.** `sql-driver-diagnostic-value-probe.test.ts` plants
  a canary, raises each candidate family through the driver's own bind path against
  the live MySQL 8.0 / PostgreSQL 16 services the `Temporal Conformance (live PG +
  MySQL)` job already stands up, and asserts of every family — value-bearing or not
  — **where the canary lands**: `error.message` (which `ObjectLogger.write`
  serializes, so an exposure) or `error.detail` (which it does not). A family that
  starts inlining a value it did not inline before is now a named red naming the
  file to edit, instead of a silent leak.
  
  Measured with a positive control first (`ER_DUP_ENTRY`, the known-value-bearing
  neighbour, reproduced verbatim — without it a zero elsewhere would be
  uninterpretable):
  
  | dialect | family | diagnostic, verbatim | verdict |
  |:--|:--|:--|:--|
  | mysql | 1062 | `Duplicate entry 'CANARY' for key 'probe.uq'` | value on `message` (already encoded) |
  | mysql | 1366 | `Incorrect integer value: 'CANARY' for column 'age' at row 1` | **value on `message`** |
  | mysql | 1292 | `Incorrect datetime value: 'CANARY' for column 'when_at' at row 1` | **value on `message`** |
  | mysql | 1264 | `Out of range value for column 'age' at row 1` | identifier only |
  | mysql | 1406 | `Data too long for column 'label' at row 1` | identifier only |
  | mysql | 1054 | `Unknown column 'zzz…' in 'field list'` | identifier only |
  | pg | 22P02 | `invalid input syntax for type integer: "CANARY"` | **value on `message`** |
  | pg | 22007 | `invalid input syntax for type timestamp with time zone: "CANARY"` | **value on `message`** |
  | pg | 22003 | `value "99999999999" is out of range for type integer` | **value on `message`** |
  | pg | 23505 | `duplicate key value violates unique constraint "…"` | value on `detail` only |
  | pg | 23502 | `null value in column "id" … violates not-null constraint` | value on `detail` only |
  | pg | 22001 | `value too long for type character varying(20)` | identifier only |
  
  Both families the card named as candidates **are** value-bearing, and the
  Postgres one is the sharper result: #8823 recorded that Postgres escapes the
  unique-violation leak only because its value sits on `error.detail`, a field the
  logger never serializes — *"coincidence, not a defence"*. `22P02` / `22007` /
  `22003` put the caller's value on **`error.message`**, the field that IS
  serialized, so the coincidence does not cover them.
  
  The one-off regex pair is now an enumerable `VALUE_BEARING_TEMPLATES` table, one
  row per measured family, each citing the live server that produced it. Every
  identifier-bearing tail is still kept whole — over-matching deletes the
  diagnostic an operator came for, which is the expensive direction #8682 paid to
  avoid, and the six identifier-only families above are pinned against exactly that
  regression.
  
  **Known residue, measured and deliberately not closed here:** when the caller's
  value itself contains ` - `, the statement cut lands inside it and eats the
  template head. Families with a right anchor (`for key …`, `for column … at row
  N`) recover; the two whose value runs to end of message (pg 22P02/22007, mysql
  1292's `Truncated incorrect …` spelling) have no anchor and leave a suffix
  standing. Closing that requires the cut itself to become template-aware — a
  change to #8682's contract, filed rather than decided.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [899052a]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [1e050a5]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/observability@17.1.0

## 17.0.0

### Major Changes

- 2d3e255: feat!: ADR-0113 — `required` is a write contract; the column constraint becomes the explicit `storage.notNull`

  `field.required` bound three meanings to one knob (write check, `NOT NULL` DDL,
  drift expectation), so tightening any invariant on a deployed object was a
  destructive migration blocked by the very legacy nulls that motivated it — the
  reason `criteria_json`'s mandatory-in-substance contract lived in three
  imperative guards instead of one declaration.

  Split, with the **non-regression invariant** as the unifying rule — _a write
  may not take a record from compliant to violating; a pre-existing violation
  does not block writes that leave it in place_:

  - `required: true` = the write contract, uniformly on new and deployed objects:
    insert must provide; **an update PATCHing `null` into a required field is now
    rejected** (it silently passed before); omitted fields never block, so legacy
    null rows rest. The column stays nullable.
  - `storage: { notNull: true }` = the explicit physical constraint, owning the
    DDL (`sql-driver` `createColumn`) and the destructive drift ceremony.
    Orthogonal to `required` — all four combinations are legitimate, including
    the engine-populated column (`storage.notNull` without `required`).
  - `requiredWhen` inherits the same invariant: flipping the condition true
    without providing the field is rejected (the write _creates_ the violation);
    a row violating since before the rule tightened no longer locks out
    unrelated edits (#3929's objection, cured). `storage.notNull` ×
    `requiredWhen` rejects at parse (`FieldSchema.superRefine`).
  - **Pre-17 sources keep their exact meaning** via the migration-chain-only
    `field-required-notnull-explicit` conversion: `os migrate meta` stamps
    `storage.notNull` onto every previously-required field — writing down what
    the old text already meant. The loader never infers semantics from the
    physical column.
  - Drift compares nullability against `storage.notNull`; a column stricter than
    its declaration is `needs_confirm` (never auto-applied — dev auto-reconcile
    no longer silently strips a stray `NOT NULL`), and silent when the field is
    write-gated by `required`.

- 29e28a3: refactor(drivers)!: `aggregate` 的 query 参数收窄到 `DriverQuery`，并退役 `aggregate` / `func` 两个未声明别名 (#6212 批 B、#6321)

  #5181（PR #6076）收窄了 `IDataDriver` 声明的六个方法，#6075（PR #6210）让五个驱动的实现跟上，#6212 批 A+E 处理了 SQL 驱动自有的另两道门。本次是同一条线上的 `aggregate`：`driver-sql`、`driver-turso` 的转发层与 `RemoteTransport` 三处，全部从 `query: any` 收到 `DriverQuery`（`@objectstack/spec/contracts`）。

  `any` 在 query 参数上不是「对象名没检查」，而是**检查全关**：`where` 的 filter 方言、`groupBy` 的节点联合、`aggregations` 的节点形状——而这三样恰恰是这几个方法体读的全部内容。

  ## 一、退役两个协议从未声明的别名（#6321，ADR-0049）

  ```ts
  const aggregates = query.aggregations || query.aggregate; // driver-sql
  const funcName = agg.function || agg.func;
  const aggregations = query?.aggregations || query?.aggregate || []; // RemoteTransport
  const func = String(agg.function || agg.func || "");
  ```

  `QueryASTSchema` 声明的是 `aggregations`，`AggregationNodeSchema` 声明的是 `function`；`aggregate` / `func` 在 `packages/spec` 里**一个字都没有**。实测全仓唯一书写者是这两个驱动包自己的 fixture（`sql-driver-advanced` 7 处、`sql-driver-queryast` 1 处、`sqlite-wasm-driver-advanced` 7 处、`sqlite-wasm-driver-queryast` 1 处），非测试面零书写者——#4984 那一家：**fixture 拼着别名，宽容分支就永远绿着活下去，没有任何测试能在删掉它时转红**。fixture 已按已声明拼写重拼，写者归零，PD#12 与 ADR-0049 enforce-or-remove 于是把这两条 `||` 一并删掉。

  顺带删掉的还有 `|| ''`：它只在**两个键都没写**时才生效，而那时这一面把名字回引成 `""`、本地面回引成 `"undefined"`，同一份越界输入两种措辞（#5240）。别名在时这条岔路够不着，删别名恰恰让它够得着，所以同一次关掉。

  **迁移**：`aggregate:` → `aggregations:`，`func:` → `function:`。写旧拼写的内联字面量现在是编译错误（TS2353）；越过 `tsc` 的 JS 调用方，`aggregate:` 会静默拿不到聚合列，`func:` 则拿到已有的具名 400（`INVALID_QUERY`，#5907）。本仓实测需要改动的非测试调用点为零。

  ## 二、一处真实行为改动：`RemoteTransport` 现在会编 `GroupByNode` 联合

  `GroupByNodeSchema` 是 `z.union([z.string(), z.object({ field, dateGranularity?, alias? })])`，而这一层把它当 `string[]` 读。收窄后 `tsc` 直接把这条假设摆上台面（TS2322）。联合的两半状况完全不同，所以这不是一个 cast 能了事的：

  - **无 granularity 的结构化条目**（`{ field: 'region' }`）是 spec 合法、且**今天就会下推到驱动**的形状：objectql 的 aggregate 派发对它一律判为「受支持」（`engine.ts` 里逐字写着 `plain {field} object is fine`），`objectql/src/secret-fields.test.ts:341` 就是这个形状的活体。本驱动的**本地面**把它编成普通的 `GROUP BY "region"`，远端面却把它插值成 `"[object Object]"`、死在标识符安全检查里——一条查询两种答案、由连接串决定，正是 #6203 那个形状，而且**是活体不是休眠**：能力位 `queryDateGranularity` 只管带 granularity 的那一半，管不到这一半。现在读 `.field`，两面收敛。
  - **带 dateGranularity 的条目**远端确实编不出来，而这一点是**已声明**的：remote 模式发布 `queryDateGranularity: {}`，引擎据此全部落到内存分桶，因此不会下推。缺的是「绕过能力位、直连驱动」的那个调用方该得到什么答案——现在得到 ADR-0112 信封（`NOT_IMPLEMENTED` / 501），与聚合函数「协议已声明、本后端编不出」用的是同一类，而不是一句 SQL 注入告警。

  `alias` **不读**，与本地面一致：`SqlDriver.aggregate` 也不读它，只在这一面读会是新的分叉而不是修复。

  ## 三、`SqlDriver` 那一面的同一条件也换上了信封

  `SqlDriver.aggregate` 对「本方言编不出这个 granularity」原本抛裸 `Error`（`code`/`status` 皆 `undefined` ⇒ `mapDataError` 落默认分支，一个具名能力缺口以不透明 500 到达调用方）。只给远端面加信封就会造出 #5907 花一整个 issue 才关掉的那种分叉——`TursoDriver` 由 `url` 选面，同一条件不能有两种线上身份。两面首句逐字一致（`Date bucketing by '<g>' is not supported by this backend.`），尾句各报**本面**编得出的 granularity，由一条跨包 parity 用例比对两个**运行时**消息钉住。

  **消息文本变更**（可能影响按文本匹配的下游断言）：

  ```
  - SqlDriver: dateGranularity 'week' not supported on dialect 'better-sqlite3'. Engine must fall back to in-memory bucketing.
  + Date bucketing by 'week' is not supported by this backend. Bucketed here: day, month, quarter, year (dialect 'better-sqlite3'). … (code=NOT_IMPLEMENTED, status=501)
  ```

  ## 定级依据

  标 major 与 #5181 / #6075 / #6210 一致：**源码级破坏性**（调用点内联字面量、以及被删的两个别名键），加上第二、三节两处真实的运行期改动。`check:api-surface` 只记录导出的存在与否、不记录签名，所以这条说明是该变更唯一的下游载体。

  `driver-sqlite-wasm` 未列入：它整个继承 `SqlDriver.aggregate`，自身源码零改动（改的只有它的 fixture 与一条断言）——与批 A+E 的处理一致。它读的是 driver-sql 的 `dist/*.d.ts`，因此验证时**必须先重建 driver-sql** 再 typecheck/test，否则是假绿。

  <!-- adr-0087: registered driver-aggregate-undeclared-key-aliases-removed -->

- c6d1cb4: refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

  `findStream` was a **required** method on the driver contract — every driver and
  every test double had to implement it — documented as the read

  > Optimized for large datasets to avoid memory overflow.

  Three things were true about it at once, and each is worse in the light of the
  others.

  **Nothing called it.** Not the query engine (there is no `stream` entry on it),
  not REST export, not import, not any bulk-read path. Repo-wide, outside the
  contract declaration and the three driver implementations, every single hit was
  a test double — and roughly twenty of those satisfied the required method like
  this:

  ```ts
  findStream() { throw new Error('not implemented'); }
  ```

  Twenty stubs that throw, across four packages, for years, and no test ever went
  red. That is not an anecdote about test hygiene; it is the proof of absence. A
  method whose every double throws is a method nothing reaches.

  **Two of the three implementations inverted its one guarantee.** `SqlDriver` and
  `InMemoryDriver` both did this:

  ```ts
  const results = await this.find(object, query, options); // ← the entire result set
  for (const row of results) yield row;
  ```

  The whole table is resident in memory before the first `yield`. A caller who
  believed the doc comment and reached for `findStream` precisely because a result
  set was too large would have hit the overflow it existed to prevent, at exactly
  the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
  admitting it.

  **The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
  did walk a cursor — but it was the only read in that driver never routed through
  `buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
  discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
  and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
  that divergence rather than fixing it — there is nothing left to fix it for.)

  Rather than manufacture a caller to justify three implementations, the method is
  retired. If a cursor-based read is wanted, it should arrive **with** the caller
  that needs it, so the contract can be shaped by a real requirement instead of
  being reverse-engineered from a doc comment nobody could test.

  **Migration.**

  | Wrote                                                      | Write instead                                              |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
  | `findStream(…) { … }` on your own driver                   | delete the method (see below)                              |
  | `findStream() { throw new Error('ni'); }` in a test double | delete the line                                            |

  Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
  and memory it is strictly better (bounded pages instead of one full
  materialisation), and the paged read is the one with an **enforced** guarantee —
  `IDataDriver.find` requires a total order across the whole walk, checked by the
  shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
  `data/pagination-conformance.ts`. `findStream` never had a conformance case at
  all.

  **Driver authors: nothing breaks on you.** An implementation left in place still
  compiles — an extra method is not an error on a class or a widened object — it is
  simply never reached, so deleting it is cleanup you can do whenever. The break is
  on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
  were no callers.

  **No tombstone, deliberately.** The other v17 retirements tombstone their key so
  authoring it fails loudly with a prescription. That would be noise here.
  `DriverInterfaceSchema` describes a contract that code _implements_; nothing in
  either repository ever ran a driver object through `.parse()`, so a
  `retiredKey()` there would carry its prescription to no one. The channel that can
  carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
  The key is removed from the schema and from `IDataDriver`, and the retirement is
  registered as the `data-driver-find-stream-retired` semantic entry in the
  protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool all carry it. There is no
  `os migrate meta` step: a driver is code, never stack metadata, so the chain has
  no source to rewrite.

  **Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
  whose only referent was this method. It has no readers either (and the values
  written into it were already wrong — `SqlDriver` declared `streaming: false`
  while implementing `findStream`, `InMemoryDriver` declared `true` for the
  copy-everything version), but removing a key from the capabilities literal breaks
  every driver that writes it, third-party included, and the same audit should
  cover the other ~30 flags in one pass rather than one at a time. Tracked as
  #4634.

- d9fa683: refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

  The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
  described a contract method that no longer exists — and a full liveness audit of
  the record (#4634, across objectstack + cloud, objectui confirmed clean) found
  `streaming` was not the exception but the rule. Of 34 declared bits, **three**
  have a decision-making reader and **thirty-one** were written by every driver
  and consulted by no engine, planner, REST layer or renderer:

  - Their `.describe()` strings promised engine adaptation that was never built
    ("If false, ObjectQL will fetch all records and filter in memory" — no such
    fallback ever keyed off the bit).
  - Zero readers let values go WRONG unnoticed: `SqlDriver` declared
    `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
    `streaming: true` over a full-table read — the exact inverse of the guarantee.
  - The real mechanism everywhere else is **method presence**: transactions gate
    on `driver.beginTransaction`, aggregate pushdown on
    `typeof driver.aggregate === 'function'`, schema sync on
    `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
    are called unconditionally.

  Survivors (each with a named reader — the bits method presence cannot carry):

  | bit                    | reader                                                                                   |
  | ---------------------- | ---------------------------------------------------------------------------------------- |
  | `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
  | `autonumber`           | engine defers autonumber generation to the driver (`engine.ts`)                          |
  | `batchSchemaSync`      | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`)              |

  Migration (FROM → TO):

  - Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
    `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
    `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
    `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
    `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
    `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
    `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
    literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
    tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
    error against `IDataDriver.supports` and a parse error carrying the per-key
    prescription, which names the mechanism that actually decides the behaviour.
  - `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
    already meant `false` at both readers, so `supports: {}` is now a valid,
    minimal advertisement. If you read `capabilities.batchSchemaSync` from a
    _parsed_ config and relied on the materialised `false`, treat absence as
    `false` (both engine readers always did).
  - Driver packages: `InMemoryDriver.supports` is now `{}`,
    `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
    is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
    Reading a removed bit off these literals no longer type-checks — and no code
    in any repository did.
  - A future capability (streaming reads, vector search, …) returns **with its
    caller and its reader in the same change** — the enforce route of ADR-0049 —
    never as a dangling boolean.

  The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
  (parse + `tsc` both audible; the schema IS parsed via
  `DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
  semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
  never stack metadata — `supports` lives in driver classes and `DriverConfig`
  is plugin TS configuration, so there is no stored row or stack source for a D2
  conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
  retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
  lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
  asserting every retired bit is unwritable (`undefined`) and every live bit is
  not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
  resurrection).

  No runtime behaviour changes — that impossibility is the point: every removed
  bit had zero readers, and the three live bits keep theirs.

- d367f03: refactor(drivers)!: 五个驱动的 query 参数跟进 `DriverQuery`，休眠的类型谎言就此没有藏身处 (#6075)

  #5181（PR #6076）把 `IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的 query 参数收窄为 `DriverQuery`（`Omit<QueryAST, 'object'>`），并在同一条 changeset 里写明：「把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾」。这就是那次收尾。

  在此之前，五个驱动的实现仍旧声明 `query: QueryAST`（turso 侧是 `query: any`）。**它不红，也不会红** —— 方法参数按双变比较，实现声明得比契约宽照样满足契约。但调用方现在**有权**省略 `object`，于是这些实现的类型说 `query.object` 是 `string`，运行期却可能是 `undefined`：一句休眠的谎言，没有任何门拦得住下一个照着它写代码的人。

  收尾之后，「驱动读 `query.object`」直接变成编译错误：

  ```ts
  // 收窄前：编译通过，运行期可能是 undefined —— 谎言
  // 收窄后：error TS2339: Property 'object' does not exist on type 'DriverQuery'.
  const name = query.object;
  ```

  **零运行时改动。** 本次改的全部是类型注解：五个驱动的六个契约方法签名，以及为让类型自洽而必须跟进的少量私有辅助方法参数（mongodb 的 `buildFindOptions` / `buildSortSpec`，sql 的 `findRows` / `orderKeysFor`，turso 的 `toRemoteQuery` / `toRemoteReadQuery`，memory 的 `performAggregation`）—— 它们都只转发或读取 `where` / `orderBy` / `groupBy` 这些字段，本来就不读 `object`。turso 的几处 `query: any` 一并收紧，多拿回一批本已放弃的检查。emit 无差异，测试全绿（memory 524、mongodb 206、sql 906、sqlite-wasm 254、turso 788）。

  **迁移面：删掉驱动调用字面量里的 `object:` 键**，与 #5181 是同一句话，只是现在也覆盖了直接按具体驱动类（`SqlDriver` / `MemoryDriver` / …）而非按 `IDataDriver` 取类型的调用方。编译器会逐处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。本仓下游 25 个包实测零处需要改动，改动只落在五个驱动自己的测试里。

  标 major 的依据与 #5181 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

  `aggregate` / `distinct` / `syncSchemasBatch` 不在本次范围内 —— 它们不是 `IDataDriver` 收窄的那六个方法，其中 `syncSchemasBatch` 的条目里 `object` 是被真实读取的必填键，`expand` 条目里的 `object` 同理命名的是关联对象，都不是冗余。

- 62159bd: refactor(driver-sql)!: `SqlDriver.distinct` 的第三参收成裸 `FilterCondition`，一个静默返回全集的写法就此编译不过 (#6320)

  `distinct` 不在 `IDataDriver` 上，所以 #5181（PR #6076）与 #6075（PR #6210）的收窄都没走到它，#6212 批 A+E（#6355）收的是 `analyzeQuery` / `findWithWindowFunctions`，也没覆盖它。它的方法体一直说得很清楚——`applyFilters(builder, filters)` 拿的是**实参本身**，因此它要的是 `find()` 放在 `query.where` 里的那个值，**不是 query 信封**；`filters?: any` 只是没把这句话写进类型里。

  ```ts
  // 收窄前后都成立，一处调用点都不用改
  await driver.distinct("orders", "product", { status: "completed" });
  ```

  **收窄真正买到的东西，是实测出来的，不是推断的。** 三行数据（`Laptop`/`Mouse` 为 `completed`，`Ghost` 为 `pending`），逐个形状喂给 `distinct('orders','product', …)`：

  | 第三参                       | 收窄前                             | 收窄后       |
  | :--------------------------- | :--------------------------------- | :----------- |
  | `{ status: 'completed' }`    | 返回 `["Laptop","Mouse"]`          | 不变         |
  | 省略                         | 返回全集                           | 不变         |
  | `'completed'`（标量）        | **编译通过，返回全集**             | **编译错误** |
  | `{ object, where }`（信封）  | 抛 `INVALID_FILTER` / 400          | 不变         |
  | `['status','=','completed']` | 抛 `INVALID_FILTER` / 400（#5158） | 不变         |

  第三行就是本次消掉的那一格：一个真心想问「completed 订单里有哪些商品」的调用，编译通过，然后拿到**每一个**商品。`applyFilters` 对「真值但非对象、非数组」的 filter 不发射任何谓词（该方法尾注写着这件事），于是过滤条件被整条丢掉。方向是**放宽**——这正是 #6320 与 #5234 同族的那类「静默错答案」。

  **有一格是任何类型都关不上的，本次如实写进注释而不是假装关上了。** `FilterCondition` 的键**就是字段名**，所以它是开放映射（`[key: string]: any`）：`{ object, where }` 在结构上是一个完全合法的 filter——约束两个分别叫 `object` 和 `where` 的列。没有任何注解能把它和正当 filter 分开。#6320 提出的「让反向错配也编译不过」在这个参数上**不可达**，实测确认；能拿到的保证是**运行期响亮失败**：信封里的 `where` 是对象，而没有任何比较值可以是对象，于是 `assertCompilableComparand` 抛 `INVALID_FILTER` / 400。这半边 driver-sql 从来就不是静默的；`driver-memory` 那半边（裸 filter 交给它会静默返回全集）留在 #5499 冻结面内，本次不碰。

  **零运行时改动**：非测试改动 100% 是一个类型注解加一段注释，无逻辑、无行为、无 emit 差异。

  **逐处复核了全部 14 个调用点**（本单正文记的是 3 处，实测偏低）：driver-sql 11 处、driver-sqlite-wasm 3 处、driver-turso 0 处；其中真正传第三参的是 4 处（driver-sql 2 + driver-sqlite-wasm 2），全部本来就写的裸 filter，**零报错、零 fixture 改动**。

  **driver-sqlite-wasm 也标 major**：`SqliteWasmDriver extends SqlDriver` 且不覆写 `distinct`，所以它**已发布的 `.d.ts`** 里这个方法的签名同样收窄，它的使用者看到的是同一个变化。该包读的是 driver-sql 构建后的 `dist/*.d.ts` 而非源码，是一处已知门禁盲区，本次用「往参数类型里临时塞一个调用方不可能满足的成员、重建、看调用点是否逐一变红」证明它确实读到了新 d.ts：driver-sql 6 处红、driver-sqlite-wasm 3 处红，与预判逐一相符。

  ### 迁移

  调用点若把**标量**（或任何非 `FilterCondition` 值）交给第三参，编译器会指出来：

  ```
  error TS2345: Argument of type 'string' is not assignable to parameter of type 'FilterCondition'.
  ```

  改法是把它写成它本来就该是的裸 filter 对象（`'completed'` → `{ status: 'completed' }`）。⚠️ 这类调用点在收窄前拿到的是**未过滤的全集**，所以这不是一次等价改写：修完之后返回值会变，而变化后的那个才是调用方本来想要的答案。本仓零处这样的调用点。

  ⚠️ 无类型的 JS 调用方**既不会拿到编译错误、也不会有任何行为变化**（本次零运行时改动）。对他们而言，上面那条是「你一直没在过滤」的**唯一通知渠道** —— 这也是本次记台账条目的理由，见下。

  <!-- adr-0087: registered driver-sql-distinct-bare-filter-typed -->

- d48aad5: refactor(driver-sql)!: `analyzeQuery` / `findWithWindowFunctions` 不再吃 `any`，窗口门自带扁平形类型 (#6212 批 A+E)

  #5181（PR #6076）收窄了 `IDataDriver` 声明的六个方法，#6075（PR #6210）让五个驱动的实现跟上。收尾漏下的是**驱动自有、不在 `IDataDriver` 上**的那批查询门：它们同样吃 query AST，签名却是 `any`。本次处理 SQL 驱动的两个。

  `any` 在 query 参数上不是「对象名没检查」，而是**检查全关**：`where` 的 filter 方言、`orderBy` 的 sort node 形状、`limit`/`offset` 是不是数字，全部被抹掉——而这两个方法体读的恰恰就是这些字段。`$like` 当年就是从同一个口子活到运行时的（cloud#1030、cloud#1053 实测 20 处）。

  **`analyzeQuery` → `DriverQuery`。** 它是 `explain()` 的实现体，而 `explain()` 本来就声明 `DriverQuery` 并一行转发过来——收窄前这一对是自相矛盾的：契约门声明 AST，它背后的实现声明 `any`。方法体只读 `fields` / `where` / `orderBy` / `limit` / `offset`，全在 `DriverQuery` 内，因此这是一次纯注解：driver-sql 与 driver-sqlite-wasm 实测零报错、零 fixture 改动。

  **`findWithWindowFunctions` → 驱动本地的扁平形类型**，新导出 `SqlWindowFunctionQuery` / `SqlWindowFunctionSpec`：

  ```ts
  import type { SqlWindowFunctionQuery } from "@objectstack/driver-sql";

  const ranked = await sqlDriver.findWithWindowFunctions("employee", {
    windowFunctions: [
      {
        function: "rank",
        alias: "salary_rank",
        partitionBy: ["department"],
        orderBy: [{ field: "salary", order: "desc" }],
      },
    ],
  });
  ```

  它**不能**标 `DriverQuery`：`query.windowFunctions` 在 spec 是 `retiredKey()` 墓碑（#4286），`QueryAST['windowFunctions']` 解析为 `undefined`，标上去会让这道门自己已发布文档里的载荷编译不过。类型因此写成 `Omit<DriverQuery, 'windowFunctions'> & { windowFunctions?: SqlWindowFunctionSpec[] }`——契约那一半照旧受检，驱动私有那一半由驱动自己声明。

  类型放在驱动层、**不进 `packages/spec`**，是接着 #4286 的判断往下走：那次删掉 `WindowFunctionNodeSchema` 的理由正是它声明了 `field` / `over` / `frame` 这些门从不读的成员；再往 spec 加一套窗口词汇就是反悔那个判断。spec 的删除注记与 `migrations/registry.ts` 的迁移处方里逐字写着的 `{ function, alias, partitionBy?, orderBy? }`，就是这个类型的出处，三处必须始终说同一句话。请求面的墓碑**没有**被重新打开：`analyzeQuery('o', { windowFunctions: [...] })` 依然是编译错误。

  **顺带（#6212 批 F）**：`@objectstack/verify` 的 `BucketableDriver.aggregate` 从 `query: unknown` 收到 `DriverQuery`。这是一个**已发布**的结构替身，cloud 的 driver-turso 照着它实现——声明 `unknown` 不叫「最小」，叫没检查，并且放任该文件里两处 AST 字面量各自把对象名多写一遍（#5181 的那种冗余）。同时删掉一处 `as never`：那个 cast 只是因为字面量推断把 `'count'` 放宽成了 `string`，注上类型就不需要它了。这里**不预断**驱动自身 `aggregate` 参数类型的收窄（#6212 批 B，排在 #6203 之后）——方法参数按双变比较，驱动那边声明 `any`、`QueryAST` 还是收窄后的类型，都照样满足这个替身。

  **零运行时改动**，全部是类型注解与两处冗余键的删除（实测全仓驱动无一读 `query.object`）。测试：driver-sql 935、driver-sqlite-wasm 254、driver-turso 804、verify 17、dogfood 520 全绿。

  **迁移面**：直接调用这两道门的嵌入方，把内联字面量里编译器指出来的键改对即可（TS2353）。本仓实测非测试生产者为零，两道门只有各自驱动包的测试在用，零处需要改动。标 major 的依据与 #5181 / #6075 一致：**源码级破坏性**（调用点内联字面量与 `BucketableDriver` 的导出形状），运行时行为零变化；`check:api-surface` 只记录导出的存在与否、不记录签名，所以这条说明是该变更唯一的下游载体。

### Minor Changes

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- c8124e5: fix(driver-sql): give `Field.datetime` one UTC storage form per dialect (#3912, #3942)

  Any window filter on a `Field.datetime` column returned an empty set on SQLite —
  a dashboard `dateRange: last_30_days` on `created_date` read 0 while 29 matching
  rows existed.

  There was never a storage _convention_, only a description of what better-sqlite3
  happened to do with a bound JS `Date`. Nothing enforced it — `formatInput`
  deliberately left `datetime` untouched — so the form was decided by whichever
  writer got there first: a JS `Date` landed as INTEGER epoch ms, while a REST/JSON
  write (JSON has no `Date` type), a `defaultValue: 'NOW()'` slot, and the
  platform's own `created_at` / `updated_at` all landed as ISO **TEXT**. One column
  held both forms while the read path coerced comparands to epoch ms purely from
  the _declared_ type. On SQLite's type ordering (`INTEGER < TEXT`) a two-sided
  window collapsed to zero rows, and a one-sided `>=` matched every TEXT row
  regardless of the bound.

  `Field.datetime` now has one canonical instant per dialect, produced by one
  function applied on write **and** to every filter comparand, so the two sides of
  a comparison cannot disagree about shape:

  - **SQLite** — `YYYY-MM-DDTHH:MM:SS.sssZ` text. Lexicographic order _is_
    chronological order, so range filters and `ORDER BY` read the column directly
    and can use an index; `strftime` parses it, so the date-bucket expression needs
    no CASE.
  - **Postgres** — `timestamptz`, unchanged. The fix here is on the write and
    comparand side: a zone-naive write was previously resolved against the
    _server's_ timezone (measured 8 hours off on `Asia/Shanghai`), and an
    un-anchored `YYYY-MM-DD` comparand meant the server's local midnight, so the
    identical query over the identical instant landed a row on a different calendar
    day than SQLite did.
  - **MySQL** — `DATETIME(3)` instead of `TIMESTAMP`, a connection pinned to UTC on
    both the mysql2 and the server layer, and a MySQL-spelled bind carrying the
    same UTC wall clock. MySQL accepts neither the `T` separator nor the `Z` suffix
    in a datetime literal, so datetime writes over REST had always failed outright;
    `TIMESTAMP` additionally truncated milliseconds and could not store an instant
    outside 1970..2038.

  Existing rows converge at schema sync. Both migrations are allowed to fail: they
  log, mark nothing, and the read paths keep a repair expression, so an un-migrated
  column still compares and buckets **correctly** — just unindexed. Neither can
  repair instants the old timezone-ambiguous write path recorded wrongly; they
  preserve what is on disk.

  Also closes #3928 (datetime `ORDER BY` mis-sorted on mixed storage) by
  construction. Rationale is recorded as ADR-0053 addendum D-B1..D-B4.

  The analytics change is additive: a `coerceTemporalFilterColumn` companion to the
  existing `coerceTemporalFilterValue` hook, so a raw-SQL strategy can normalise the
  column side too. Absent hook → byte-identical SQL.

- 32d3800: fix(driver-sql): bound a connection attempt at 10s, and correct the "no reconnection" claim (#3769, #3759)

  Two related corrections, both from measuring what #3741/#3751/#3765 had only asserted.

  **The claim was wrong.** #3751 and #3765 shipped several statements that drivers
  never reconnect — "there is no lazy reconnection", "NOT retried and NOT
  reconnected", "stays disconnected for the process lifetime". Measured, both
  drivers recover on their own:

  - driver-mongodb: killing a real `mongod` and restarting it on the same port,
    the _same_ driver instance served the next write successfully (13ms), with no
    reconnect call from us — the official driver's topology monitor handles it.
  - driver-sql: a knex/pg pool is not poisoned by an outage. Its error tracks live
    server state (`ECONNREFUSED` while down → a handshake error once a listener is
    back → `ECONNREFUSED` again), i.e. every acquire opens a fresh connection.
    `storage-driver.ts` also configures `pool.min: 0`, so no stale idle
    connections are held.

  The original reasoning grepped this repo for `reconnect`, found nothing, and
  concluded recovery does not happen — but the recovery lives in the client
  libraries, not in our code. The claims are now corrected in `DriverConnectError`,
  the `DEGRADED BOOT` banner, `resolveAllowDriverConnectFailure`'s docs, and the
  drivers / self-hosting pages.

  **Fail-fast at boot is unchanged and still correct** — the reason is just
  different. It is not that the connection can never return; it is that the _boot
  sequence_ never re-runs. A driver that missed `init()` also missed
  `syncRegisteredSchemas()`, so its tables can simply not exist even after the
  database comes back. The banner now says that.

  **The real defect underneath.** `SqlDriver` passed its config to knex untouched,
  so a database endpoint that accepts TCP but never completes the handshake — an
  overloaded instance, a half-open firewall, a load balancer mid-failover — made
  every query wait out tarn's 30s default, then fail with `Timeout acquiring a
connection. The pool is probably full`, pointing an operator at pool sizing
  instead of the network. With a small `pool.max` a few such queries saturate the
  pool and everything else queues.

  `SqlDriver` now defaults `pool.createTimeoutMillis` to **10s**, matching
  driver-mongodb's existing `connectTimeoutMS ?? 10_000` so both drivers give up on
  an unreachable server at the same point. A host that sets its own
  `createTimeoutMillis` is left alone.

  **Migration.** None for a healthy datasource. A deployment that deliberately
  relies on connection establishment taking longer than 10s (a slow cross-region
  replica) should set `pool.createTimeoutMillis` explicitly on its `SqlDriver`
  config.

  Not fixed here, tracked in #3769: knex still reports the bounded wait as "the
  pool is probably full". An accurate message needs a dialect-specific connect
  timeout (pg's `connectionTimeoutMillis`), which changes the shape of `connection`
  and would regress the startup banner's URL display.

- 0f17114: fix(driver-sql,driver-memory,formula)!: `{ field: {} }` 一律拒收 —— 零个操作符的字段约束不再在四个后端有三个答案 (#5240)

  `{ a: {} }`(一个字段,后面跟零个操作符)是 `FilterConditionSchema` 今天**声明合法**的形状,
  而同一个 filter 在同仓四条路径上有三个答案:

  | 路径                                | 改前                                                                                            | 改后                          |
  | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
  | `driver-sql`,顶层 plain map         | 抛 `INVALID_FILTER`(#5041 的比较数闸门)                                                         | 抛 `INVALID_FILTER`(专用消息) |
  | `driver-sql`,`$and`/`$or`/`$not` 内 | 遍历零个操作符 → 不产出任何 SQL → **TRUE(匹配全表)**                                            | 抛 `INVALID_FILTER`           |
  | `driver-memory`                     | 实时路径经 mingo 变成「字段深等于空文档」;参考匹配器落到 `JSON.stringify` 结构相等 → 顺带 FALSE | 抛 `INVALID_FILTER`           |
  | `@objectstack/formula`              | `keys.length === 0` 显式 fail-closed → FALSE                                                    | 抛 `INVALID_FILTER`           |

  于是 `{ $or: [ { a: {} }, { b: 2 } ] }` 在 SQL 上编译成 `(b = 2)` —— 既不是「零约束即 TRUE」
  该给的全表,也不是两个 JS 后端给的 FALSE,而是**子句被 knex 连同空分组一起丢掉**的结果;
  而 `driver-sql` 自己内部就不自洽:同一个 `{ a: {} }` 写在顶层被响亮拒收,包进一层 `$or`
  就变成静默的 TRUE。

  维护者拍板取**拒收**(不取 TRUE、不取 FALSE):这个形状几乎必然是编写期事故 ——
  筛选器记下了字段却没记下操作符,或生成的元数据把操作符弄丢了 —— 让它在编写期就炸,
  好过在某个后端上安静地多返回或少返回几行。与 #5041 已在 driver-sql 顶层建立的先例一致,
  本次只是把同一道闸门补进组合子内部。四个后端(第四个是继承 `SqlDriver` 的
  `driver-sqlite-wasm`)现在给出同一个 `INVALID_FILTER` / 400,消息里指名出事的位置
  (如 `filter.$or[0].stage`)。

  **⚠️ 可观察的行为变更 —— RLS `check` 求值路径。** `@objectstack/formula` 的
  `matchesFilterCondition` 是 `plugin-security` 对 insert/update **后像**执行行级 `check`
  的那条路径(没有查询可下推,这个求值器就是执行本身)。它改为抛出后,落在 #4775
  「求不出值 = 该次操作失败」的既定姿态上。这不只是「拒绝得更响」——有一类结果直接翻转:

  | `check` 策略                                    | 改前                                  | 改后                     |
  | ----------------------------------------------- | ------------------------------------- | ------------------------ |
  | `{ a: {} }`                                     | FALSE → 写入被拒(403)                 | 抛出 → 该次写入失败(400) |
  | `{ $or: [ { a: {} }, { owner: '{userId}' } ] }` | FALSE 被另一析取项吸收 → 写入**放行** | 抛出 → 该次写入失败      |
  | `{ $not: { a: {} } }`                           | `!false` → 写入**放行**               | 抛出 → 该次写入失败      |

  后两行是**原本能成功、现在会失败**的写入。这是拍板的目的而非副作用:一条含
  `{ field: {} }` 的权限规则,是一条作者弄丢了操作符的规则,它的含义不该取决于四个后端里
  哪一个在求值。升级后请检查 `check`/`using` 策略里是否存在零操作符的字段约束——
  错误消息会指名位置。

  同一条改动也让 `@objectstack/driver-memory` 的两个过滤面(经 mingo 的实时查询路径,
  与跨后端一致性套件所用的 `memory-matcher` 参考匹配器)第一次对这个形状给出同一个答案。

  非空形状**逐字符不变**:普通比较、`$in`、`$or`/`$and` 组合、`$not` 的 #5146 NULL-safe 改写,
  编译出的 SQL 文本与匹配结果都与改前相同;`{}`(零个键的**节点**,#5134 的布尔单位元)
  与 `{ field: {} }` 是两个不同形状,前者的语义不受本次影响。

  注:本次收紧的是**实现**。`packages/spec` 的 `FilterConditionSchema` 仍然声明这个形状合法
  (非递归半边是 `z.record(z.string(), z.unknown())`),即实现现在比已声明的契约更严;
  契约收窄与 `FILTER_LOGIC_CASES` 补条归 spec 车道另行处理。

- 6a9dec6: fix(spec): lower equality triples with a `$field` comparand to `{ $eq: ref }` (#7597)

  `parseFilterAST` lowered one authored intent two different ways depending only on
  how the operator was spelled:

  | authored                                | lowered to                                  | what it did                     |
  | :-------------------------------------- | :------------------------------------------ | :------------------------------ |
  | `['amount', '>', { $field: 'budget' }]` | `{ amount: { $gt: { $field: 'budget' } } }` | worked on both evaluation paths |
  | `['amount', '=', { $field: 'budget' }]` | `{ amount: { $field: 'budget' } }`          | matched **nothing**, silently   |

  The four equality spellings (`=`, `==`, `equals`, `eq`) dropped the operator,
  because a LITERAL comparand's implicit-equality form is `{ field: value }` —
  correct for a literal, and for a field reference it produces a field spec whose
  only key is `$field`. Every consumer reads an all-`$` key set as an OPERATOR
  SPEC, and nothing implements an operator named `$field`: the in-memory evaluator
  (`@objectstack/formula`) dispatches it to its operator switch, finds no arm, and
  returns the fail-closed `false` — so the filter matched no record on the very
  path that produced it, with no error anywhere. On SQL push-down the same shape
  arrived as an unknown operator and was refused.

  An equality triple whose comparand is a `FieldReferenceSchema` now lowers to the
  explicit `{ field: { $eq: ref } }` — the spelling both evaluation paths already
  implement (the memory evaluator resolves the reference; `driver-sql` compiles it
  to a column-to-column comparison, #5222). `['amount', '=', ref]` and
  `['amount', '>', ref]` are now the same kind of thing.

  Unchanged, deliberately:

  - **Literal comparands.** `['amount', '=', 5]` still lowers to `{ amount: 5 }`.
    The fix branches on the comparand being a field reference, never on the
    operator, and a `$field` carrying a non-string is not a field reference on any
    path — it keeps the literal lowering too.
  - **The in-memory evaluator's unknown-operator posture.** #6520 examined it and
    kept it; a hand-authored bare `{ amount: { $field: 'budget' } }`
    `FilterCondition` keeps exactly its current fate on every backend — fail-closed
    `false` in memory, and `driver-sql`'s actionable refusal naming `$eq` (#5222).
    Only what the ARRAY sugar produces has changed.

  `@objectstack/driver-sql` gains `CROSS_FIELD_AUTHORED_CASES` — the conformance
  corpus's new AUTHORING arm, entering through the lowering sink instead of at the
  already-lowered object, run by both SQL drivers' cross-field suites. Its only
  other change is documentation.

- 9774b78: fix(driver-sql): `Field.time` gets a canonical storage form — `HH:MM:SS[.fff]` wall-clock text on every dialect (#3994)

  `Field.time` repeated the pre-#3912 `Field.datetime` pattern: writes were never
  normalised and only reads were repaired, so one SQLite column accumulated bare
  time-of-day TEXT, full-timestamp TEXT and INTEGER epoch ms side by side.
  `find()` looked right; everything that compared the STORED form was wrong —
  measured: a business-hours window filter silently dropped 4 of 7 rows, ORDER BY
  sorted 14:30 before 08:00, a full-ISO write failed the statement outright on
  both Postgres and MySQL, a bound `Date` stored a process-timezone wall clock on
  pg, MySQL's bare `TIME` rounded `…00.500` up to `…01`, and a `NOW()` default
  resolved against three different clocks on the three dialects.

  The #3912→#3942→#3954 construction, transplanted (ADR-0053 D-C1..D-C3):

  - One `canonicalTimeOfDay` — `HH:MM:SS`, `.fff` only when non-zero; `Date`/
    epoch/full-timestamp fold to the UTC time-of-day — applied on write
    (`formatInput`), to filter comparands (`coerceFilterValue`, and thereby the
    `temporalFilterValue` contract hook) and on read (`toTimeOnly`).
  - SQLite: legacy columns converge at schema sync (`backfillCanonicalTimes`,
    same `IS NOT`-guarded UPDATE, same log-and-swallow policy); until then the
    filter paths wrap the column in the repair expression — correct, just
    unindexed. `os migrate plan` lists the work as `normalize_time_storage` with
    a row count.
  - MySQL: new time columns are `TIME(3)`; legacy `TIME(0)` columns widen at
    schema sync (`migrateMysqlTimeColumns`, plan kind `widen_time_columns`),
    since zero-precision TIME _rounds_ fractional writes.
  - `NOW()` defaults read the UTC clock on every dialect (Postgres previously
    used the server zone, MySQL the inserting session's zone — and MySQL 8.0
    rejects a plain `CURRENT_TIMESTAMP` default on TIME entirely).
  - `distinct()`/`aggregate()` present time columns exactly as `find()` does.

  `HH:MM:SS` writes round-trip byte-identically (the field-zoo `f_time`
  contract); a minutes-only `HH:MM` now completes to `HH:MM:00`, and uninterpretable
  values still pass through untouched.

- c7406b0: fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

  `FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
  授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
  钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

  ## 改了什么

  进入运行时的门有两扇,过去只有一扇按契约读:

  | 门                                                                                                | 改前                                                                                                                               | 改后                                                                                            |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | **Door 1** —— 协议/HTTP 面(`metadata-protocol`)                                                   | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER`                                                             | 不变                                                                                            |
  | **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动                                                                                                             | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
  | 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`)            | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400                                              |

  一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
  `RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
  删掉方言后两侧自然合流。

  ## 授权面:零变化

  `FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
  `filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
  这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

  ## ⚠️ 可观察的行为变更

  1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
     声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
  2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
     照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
     `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
     返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
  3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
     变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
  4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
     导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
     注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
     挡住这个输入,所以拒收必须在运行时。
  5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
     (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
     AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

  ## 删除的代码面

  - `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
  - `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
  - `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
  - `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

  `[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。

- 5d4de37: fix(objectql,driver-sql)!: a group key is the column's value, in the shape `find()` presents it (#3849)

  `groupBy: ['qty']` now returns `3`, not `'3'`. `groupBy: ['won']` returns `true` /
  `false`, not `'true'` / `'false'` on one path and `1` / `0` on the other. A bucket
  key is a column value, so there is one right answer for what it looks like —
  whatever that column looks like on a `find()` row — and all three paths that
  produce one now give it.

  ### What was wrong

  Three code paths produce a group key, and no two of them agreed:

  |                           | `qty` (number)   | `won` (boolean)                 |
  | ------------------------- | ---------------- | ------------------------------- |
  | `find()`                  | `3` number       | `true` boolean                  |
  | `aggregate()` pushed down | `3` number       | `0` / `1` **number**            |
  | in-memory fallback        | `'3'` **string** | `'false'` / `'true'` **string** |

  Two independent causes:

  - `applyInMemoryAggregation` ran every key through `String()`. The pushed-down
    path never did.
  - The pushed-down path returns raw builder output. #3797 taught it to present
    temporal columns the way `formatOutput` does on a `find()` row, but not the
    boolean and numeric repairs — so a SQLite boolean, which has no native type and
    is stored as `0`/`1`, surfaced as an integer from `aggregate()` and as a real
    boolean from `find()`.

  `engine.aggregate` chooses between the two aggregate paths per query — by whether
  the driver aggregates natively, whether it advertises the requested granularity,
  and whether the reference timezone is UTC — so the same column changed shape with
  no change to the data or the query.

  ### Why it mattered

  The measures were always right, which is why this went unnoticed. What broke was
  downstream code that probes a raw `Map` keyed by the value's own type. `Map`
  lookup is SameValueZero, so `'1'` never finds `1`:

  - **Select-option labels** (`dimension-labels.ts`) — the label table is keyed by
    the option's own `value`. A numeric option value never matched a stringified
    key, so the chart rendered the raw stored value instead of its label.
  - **Lookup / master-detail labels** — the id → record-name table is built by an
    inner query that always pushes down (raw ids), then probed with the outer
    query's keys, which may be in-memory (stringified). With a numeric primary key
    — routine for external/federated objects — every label missed.
  - **Cross-object rebucketing** (`cross-object-rebucket.ts`) — the FK → attribute
    map is built and probed the same way, and a miss is not a fallback but
    `RESTRICTED_BUCKET`. A numeric FK filed **every row** under `'(restricted)'`:
    one bar, correct grand total, no error.
  - **Drill-through** — the raw dimension value goes into the drill filter
    verbatim, so a boolean dimension drilled from the in-memory path sent
    `{ won: 'true' }` to SQLite, whose INTEGER column cannot equal the text
    `'true'`. Zero rows.

  ### What changed

  - `applyInMemoryAggregation` (`@objectstack/objectql`) emits the value verbatim.
    Its rows come straight from `driver.find()`, so passing the value through is
    what makes the key equal the column's own read shape.
  - The internal composite bucket id is now type-preserving, so `1` and `'1'`,
    `true` and `'true'` stay distinct groups rather than merging on the way in.
    BigInt is encoded explicitly — `JSON.stringify` throws on it, and a value that
    used to bucket under `String()` must not start crashing the aggregate.
  - `SqlDriver.aggregate` / `.distinct` (`@objectstack/driver-sql`) present group
    keys and `min`/`max` results with the same rules `formatOutput` applies on a
    `find()` row, generalizing the #3797 temporal fix to boolean and numeric
    columns. The `protected` helpers behind it are renamed accordingly
    (`temporalFieldKind` → `readPresentationKind`, `presentTemporalValue` →
    `presentReadValue`, `presentTemporalColumns` → `presentReadColumns`) and the
    kind union is exported as `ReadPresentationKind`.

  Date-bucketed `groupBy` items are unaffected: `bucketDateValue` and the dialect
  bucket expressions both produce canonical string labels, and #3839 already pinned
  their empty bucket.

  ### Gate

  `packages/qa/dogfood/test/group-key-read-shape-parity.test.ts` measures both
  aggregate paths against `find()` for a number, boolean and text column, on
  `driver-sql` and `driver-sqlite-wasm`. It asserts the runtime TYPE, not just the
  value — folding both sides through `String()` is the reflex that hid this in the
  first place and would make the check pass against the bug it exists to catch.

  Each half was confirmed to fail the gate on its own: reverting only the
  in-memory change reddens the number and boolean cases, reverting only the driver
  change reddens the boolean cases with `0<number>` against `false<boolean>`.

- 92a67f2: feat(drivers,spec)!: `GroupByNode.alias` is honoured by the SQL faces — one aggregate, one column key (#6401)

  `GroupByNodeSchema` has declared `alias` ("Alias for the projected group
  value", defaulting to `field`) for as long as the structured `groupBy` entry has
  existed. Exactly one execution path read it. The result: the SAME query came
  back with a different result-column key depending on which path the engine
  happened to take.

  ```ts
  groupBy: [{ field: "closed_at", dateGranularity: "month", alias: "qtr" }];
  ```

  - pushed down to a driver ⇒ rows keyed **`closed_at`**
  - run through the in-memory fallback ⇒ rows keyed **`qtr`**

  And the choice between them is `engine.ts`'s
  `allStructuredSupported && !tzRequiresInMemory` — a driver capability bit and a
  `timezone`, neither of which the caller can see. That is the multi-face
  consistency invariant broken in its quietest form: both answers are valid rows,
  so nothing throws and nothing looks wrong.

  **Resolved to ENFORCE**, and the leg was chosen by measurement rather than
  taste. ADR-0049 splits on whether the feature already exists: a _dangling_
  promise is removed, a _live_ one with a missing gate is enforced. `alias` is
  live — three consumers read it and change behaviour
  (`in-memory-aggregation.ts`, `MemoryDriver.performAggregation`, and
  `chartAggregateCategoryKey`), and the publish gate _compels_ it:
  `validate-react-page-props.ts` errors `REACT_CHART_AXIS_UNKNOWN` unless a
  chart's category axis is bound to `alias ?? field`, telling the author in so
  many words to "bind it to" the alias. A key the build gate makes you write is
  not a dangling promise. The count of real non-test producers is **zero**, which
  is what makes enforcing safe rather than what argues against it: no shipped
  payload changes its result keys.

  **What changed, on every SQL face at once** — a fix landing on one and not its
  twin is the #6203 shape, and `TursoDriver` picks its face from `url`:

  - **`driver-sql`** — both limbs of the structured `groupBy` branch project
    `alias ?? field`: the date-bucket limb aliases the bucket expression to it,
    and the plain limb emits `?? as ??` (only when the name actually moves — an
    alias equal to the field emits no self-rename). `presentedOutput` is now keyed
    by the OUTPUT column, matching how the aggregation branch beside it has always
    worked; an aliased group value went unpresented before.
  - **`driver-turso` REMOTE** — the same projection, `"field" AS "alias"`. The
    alias reaches the statement as a quoted identifier and is therefore held to
    `assertSafeIdentifier`, exactly like `field`.
  - **`driver-sqlite-wasm`** — inherits `SqlDriver`'s compiler; covered by its own
    conformance suite rather than by assumption.

  **GROUP BY still keys on the FIELD** on every face. Only the projection is
  renamed, so the buckets are unchanged. This is deliberate and pinned: SQLite
  resolves output names in `GROUP BY`, so a face that grouped by the alias would
  look correct here and diverge on a dialect that does not.

  `having` needed no change and now means one thing: it is applied over the
  aggregated row's own columns, so a filter on a group projection references the
  alias on every path — previously the alias on one path and the field on the
  other.

  **Conformance.** `AGGREGATION_CASES` (#6409) gains a `groupByAlias` axis and two
  cases. Their VALUES are an existing case verbatim — only the key moves — so they
  can fail only on the key, which is the point: every wrong answer in this area is
  a valid query returning plausible rows. `objectql`'s in-memory fallback is now
  **enrolled** as a fourth face, answering #6409's open question ②: it is the face
  the SQL three were converged onto, so the new behaviour would otherwise be
  pinned against nothing, and reaching it needs no engine at all —
  `applyInMemoryAggregation` is a pure function of rows and an AST.

  **Reverse verification**, predicted before running. Reverting the in-memory face
  to `g.field`: only the two alias cases move and only ONE fails — the degenerate
  `alias === field` case stays green, which is why both are in the table.
  Reverting the harness to read `c.groupBy` instead of `c.groupByAlias ?? c.groupBy`
  — the copied-neighbour mistake: everything passes on an unmodified face, a false
  GREEN, which is the failure mode that would have made the axis vacuous.

  **Frozen drivers (#5499), measured from source, not flipped.** `driver-memory`
  already returned `{ field, alias: node.alias ?? node.field }` and projects under
  the alias — it had independently reached the enforce answer, so it needed no
  alignment. `driver-mongodb` is a recorded DEBT row and the defect is wider than
  `alias`: `buildAggregationPipeline` types `groupBy` as `string[]` and builds
  `groupId[field] = '$' + field`, so a structured node — aliased or not — becomes
  the literal key `"[object Object]"`. It cannot take a structured `GroupByNode`
  at all; `mongodb-driver.ts` passes `(query as any).groupBy`, which is why `tsc`
  never saw it. Tracked on #6814.

  **Compatibility.** A caller who writes `alias` and reads the result under
  `field` on a pushdown path will now find the value under `alias` — which is what
  the key has always meant on the fallback path, and what the chart gate already
  required. Callers who never write `alias` are unaffected: the emitted SQL is
  byte-identical.

  <!-- adr-0087: not-required (no-migration-prescription) Nothing is retired: `GroupByNodeSchema.alias` keeps its declaration, its spelling and its type — it starts being HONOURED by three faces that parsed and ignored it. There is no tombstone to write and no authored metadata to rewrite, so there is no mechanical transform a migration could prescribe: every stack that validated before validates after, unchanged. The behaviour change is in the RESULT of a runtime query (a result-column key moves from `field` to `alias` on the pushdown path, converging on what the in-memory path and the chart publish gate already required), which the ledger has no channel for and no upgrader could apply a codemod to. The bang is on the changeset because callers who read that column by the field name must move, and the measured non-test producer count for the key is zero. -->

- dac6a08: feat(driver-sql)!: make index drift visible to `os migrate plan` — no more silent DDL at boot (#3728)

  The #3696 unique-scope migration converged **in place**: `syncTableIndexes` ran a
  `DROP` + `CREATE UNIQUE INDEX` during `initObjects`, in every environment,
  leaving one log line behind. `os migrate plan` showed nothing, because
  `detectManagedDrift` was column-only — `ManagedDriftOp` had no index dimension at
  all. An operator who wanted to review the DDL before it reached their database
  had no way to, and a managed schema was being auto-altered in production, which
  the #2186 contract explicitly forbids.

  Index drift is now a first-class dimension, reconciled through the same path as
  column drift:

  - **`syncTableIndexes` is additive only.** It creates indexes; it never drops or
    rewrites one. `dropLegacyGlobalUniques` is gone.
  - **New `DriftOp` variants** — `replace_unique_index` (safe: retire the legacy
    platform-wide unique in favour of the tenant composite), `create_index` (safe),
    `recreate_index` (needs-confirm; destructive when it tightens to `UNIQUE`), and
    `drop_index` (destructive).
  - **`detectManagedDrift` reports them**, `os migrate plan` renders them (index
    ops display as `table [index_name]`), and `os migrate apply` executes them.
    Index DDL is portable, so it applies directly on every dialect — no SQLite
    table rebuild.
  - **`replace_unique_index` creates before it drops**, so uniqueness is never
    unenforced mid-migration and a failed create leaves the schema untouched.
  - **Declared `indexes[]` drift is covered too**: an index metadata declares but
    the database lacks, and one whose definition no longer matches the declaration
    (the additive sync skips those by name, so they could never self-heal).
  - **Orphan detection is limited to ObjectStack's own generated naming**
    (`uniq_…` / `idx_…`, plus the pre-#3696 `<table>_<column>_unique` knex
    spelling). A hand-rolled operational index is never reported as drift and
    `--allow-destructive` will not delete it.

  **Behaviour change.** Boot no longer rewrites the index unconditionally. Dev
  (`autoMigrate: 'safe'`, what `os dev` / `os serve` use) still self-heals on
  restart, so local workflows are unchanged. Production now **warns** with an
  actionable `os migrate` hint and leaves the schema alone — the deployment stays
  on the legacy global unique (multi-tenant inserts still collide) until someone
  runs `os migrate apply`. That is the deliberate trade: a visible, pre-inspectable
  migration instead of an invisible one.

  Also fixed: `managedObjectIndexes` was never cleared when an object dropped its
  `indexes[]`, so drift detection kept expecting an index nobody declared.

  `SchemaDiffEntryKind` gains `index_mismatch` and `unmapped_index`.

- d063a96: fix(spec,drivers,formula,client): `like`/`ilike` stop being folded onto `$contains` at the wire (#7536)

  A `like` predicate that arrived over HTTP was rewritten into a substring search
  before any driver saw it, because `AST_OPERATOR_MAP` (`data/filter.zod.ts`)
  carried `'like': '$contains'`. `$contains` LIKE-escapes its comparand and wraps
  it in `%…%`, which breaks a `like` in **both** directions at once. Measured in
  QA run #7463 against showcase on SQLite:

  | filter                          | before                                                                              | now                               |
  | ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
  | `["name","like","%Industries"]` | `200`, **0 rows** — the `%` bound as a literal percent sign                         | the rows ENDING WITH `Industries` |
  | `["name","like","Industries"]`  | a substring match, **byte-identical to the `$contains` control**                    | an EXACT match                    |
  | `["name","ilike","…"]`          | `400` — `ilike` had no lowering at all, so `isFilterAST()` refused the whole filter | the case-insensitive twin         |

  The second row is the tell: `like` and `$contains` producing the same bytes
  means `like` was not reaching the driver as a pattern at all.

  The file already documented the contract being violated. `canonicalAstOperator`,
  thirty lines below the map entry, carried a hand-written exemption for
  `like`/`ilike` whose comment read: _"they are NOT substring matches at the
  driver: driver-sql passes them to SQL verbatim, so the caller binds the
  wildcards. Folding them onto `contains` would silently wrap the value in `%…%`
  and change what the query means."_ That exemption only ever shaped its own
  output; the lowering the wire path takes had none. A consequence worth naming:
  driver-sql's `like`/`ilike` handling has been unreachable from the wire since
  #5158.

  ## What changed

  **New operators `$like` / `$ilike`** on `StringOperatorSchema` and
  `FieldOperatorsSchema`. The comparand IS the pattern: `%` matches any sequence,
  `_` matches exactly one character, a backslash escapes either, and the pattern
  must cover the WHOLE value — so a pattern with no wildcards is an exact
  comparison, not a substring search. `$like` is case-SENSITIVE (the #4706 Q2 = A
  contract its `$contains` sibling answers); `$ilike` folds ASCII case and nothing
  else (Q1 = A), so `café` does not match `CAFÉ`.

  `AST_OPERATOR_MAP` now lowers `like` → `$like` and `ilike` → `$ilike`. `ilike`
  enters the AST vocabulary for the first time — it previously had no entry, so
  `isFilterAST()` refused it. `canonicalAstOperator`'s hand-written exemption is
  retired: the generic round-trip answers `like`/`ilike` by construction now, so
  the special case is gone along with the reason it existed.

  The pattern language is defined **once**, in the spec, and shared by every face
  that needs it — `hasDanglingLikeEscape`, `likePatternToRegexSource`,
  `matchesLikePattern` and `likePatternToGlobPattern`. Six faces implementing one
  pattern language separately is the `#3948` shape reached through translation
  instead of vocabulary.

  **Which backends answer, and which refuse.** `$like`/`$ilike` are deliberately
  NOT in `FILTER_OPERATORS`, the runtime allowlist several packages derive
  acceptance from — adding a name there before every face has an arm turns a loud
  refusal into a silently DROPPED predicate, which is the widening measured in
  #5701 and ruled on in #3948.

  | face                                                                 | `$like` / `$ilike`                                                                                  |
  | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
  | `driver-sql` (and `driver-sqlite-wasm`, which inherits its compiler) | **answers** — `LIKE` on Postgres/MySQL, `GLOB` on SQLite                                            |
  | `driver-turso`, both transports                                      | **answers** — the remote transport compiles independently, holds to the local one by a parity suite |
  | `driver-memory`, both faces                                          | **answers** — the in-memory double must not 400 for a filter that works in production               |
  | `@objectstack/formula` (`matchesFilterCondition`)                    | **answers** — so a write-side RLS `check` agrees with the read-side SQL                             |
  | `driver-mongodb`, objectql `having`, `service-analytics`             | **refuse**, loudly, in the ADR-0112 `INVALID_FILTER` envelope                                       |

  The refusals are the point rather than a gap: #7536 exists because a `like` was
  silently given `$contains`' meaning, and a face that quietly answers a different
  question is worse than one that refuses. Clearing the remainder means arms on
  those faces in one PR — the #6520 direction.

  **Why SQLite gets `GLOB`.** `$like` is case-exact and SQLite's `LIKE` folds
  ASCII unconditionally, which cannot be switched off per statement
  (`PRAGMA case_sensitive_like` is connection-global). That is #6518's finding,
  and the operator it landed on. Because GLOB speaks a different pattern language
  (`*`/`?`, and `%`/`_` are ordinary characters), the pattern is TRANSLATED rather
  than escaped — including GLOB's own metacharacters, which are ordinary to LIKE:
  an unescaped `*` in a GLOB pattern is the same filter bypass an unescaped `%` is
  under LIKE (#5567).

  **Refused rather than given a meaning:** a pattern ending in a lone unpaired
  backslash. No reading survives every backend — Postgres rejects such a pattern
  outright, GLOB has no escape character at all — so it is refused at the door on
  every face, by one shared test.

  ## ⚠️ Behaviour changes

  1. **`like` now means `LIKE`.** If you were relying on `like` behaving as a
     substring search — the defect — write `contains` instead. A wildcard-free
     `like` is now an exact match.
  2. **`like`/`ilike` on `driver-mongodb`, objectql `having` and analytics now
     return `400 INVALID_FILTER`** where a (wrong) substring answer came back
     before. Write `$contains`/`$icontains` on those backends. `driver-memory` is
     deliberately NOT in that list — it implements the operators, because an
     application whose tests run on the in-memory double and whose production runs
     SQL must not meet a 400 in test for a filter that works in production.
  3. **`@objectstack/client`'s `.contains()`, `.startsWith()` and `.endsWith()`
     emit different operators.** They used to build a `like` tuple by gluing
     wildcards onto the caller's value (`[field, 'like', '%' + value + '%']`),
     which was wrong twice over: the wire folded `like` onto `$contains`, which
     escaped the glued `%` back into a literal, so `.contains('name','Corp')`
     searched for the text `%Corp%` and matched only rows containing percent
     signs. And once `like` reaches the driver as a real pattern, the glue becomes
     the _other_ bug — a `%` or `_` inside the caller's own value would silently
     become a wildcard. They now emit `contains` / `starts_with` / `ends_with`,
     whose comparand is text. `.like()` is unchanged and finally works; `.ilike()`
     is new.

     Note the case semantics this corrects on paper too: `.contains()`'s docblock
     claimed "case-insensitive", but the `$contains` family is case-SENSITIVE by
     contract (#4706 Q2 = A). Use `.ilike()` for a case-insensitive pattern.

- 33a5ff4: `os migrate` no longer touches the database before you confirm, and refuses a
  SQLite database another process is using (#3917).

  **Nothing is written before the prompt.** `plan` called itself a dry run and
  `apply` gated on `[y/N]`, but both booted the full plugin set first — and boot
  schema-sync issued create-table/add-column DDL (plus the artifact's inline seed
  wrote rows) against the target database before either promise was kept.
  `SqlDriver` gains `setDeferredDdl` / `previewDeferredSchemaWork` /
  `flushDeferredSchemaDdl`: while armed, `initObjects` still registers every
  in-memory map drift detection depends on but records the physical work instead
  of performing it. Both commands boot with it armed, render the held-back work
  as a `New (additive)` section of the plan, and `apply` performs it only after
  confirmation. `os meta resync` / `os migrate files-to-references` keep the old
  behaviour — they need the tables to exist.

  **Occupancy check.** A live `os dev`/`os serve` holding the same SQLite file is
  the usual way a migration goes wrong: the migration is transactional and swaps
  tables inside the file, but the running server keeps prepared statements and a
  schema cookie the migration invalidates. `os migrate` now probes the target
  before booting — `PRAGMA locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` under
  `busy_timeout = 0`, which reports `SQLITE_BUSY` when another connection is
  _attached_, not merely writing. (`wal_checkpoint(TRUNCATE)` only sees an active
  writer, and `-wal`/`-shm` presence cannot tell a live server from a crashed one;
  both are encoded as tests.) `apply` refuses with exit 1 — `error: database_busy`
  under `--json` — unless the new `--force` flag is passed; `plan` warns and
  continues, since it writes nothing either way. SQLite only: Postgres and MySQL
  take their own server-side locks.

  `@objectstack/runtime` also exports `resolveStandaloneDatabase()`, so a caller
  can resolve the database target with the same precedence the boot uses without
  building the stack, and `createStandaloneStack` accepts `skipSeedData`.

- 9e01213: fix(cli,driver-sql): `os migrate plan` lists the datetime storage convergence (#3954)

  The datetime canonicalisation (#3912/#3942) added two steps to `initObjects`'
  physical path: a row-rewriting backfill on SQLite and a `TIMESTAMP` →
  `DATETIME(3)` column rebuild on MySQL. Both already respected the DDL deferral,
  so `plan` performed neither and `apply` performed both — the behaviour was never
  wrong. The reporting was.

  `PendingSchemaWork` could only express `create_table` / `add_columns`, so an
  operator saw a plan listing two added columns, confirmed it, and `apply`
  additionally rewrote every row of a datetime column — or took a metadata lock to
  rebuild one on a large table. The plan promises to show what apply will do.

  - `PendingSchemaWork.kind` gains `normalize_datetime_storage` and
    `widen_datetime_columns`, plus an optional `rows` carrying how much data the
    step touches: row-writes for the backfill, the table's size for the rebuild —
    the number that decides "now" versus "in a maintenance window".
  - `previewDeferredSchemaWork()` measures both without performing either, reusing
    the exact predicate each migration uses (the backfill's whole `WHERE`, the
    widening's own `information_schema` filter) so the plan and the apply cannot
    name different sets. A probe that cannot run is swallowed to "unlisted", never
    to a failed plan.
  - The CLI renders them under their own heading rather than folding them into the
    additive section, whose "created when you apply" framing carries an implicit
    promise that the work is never data-losing. `summarizePendingSchemaWork` — the
    line read just before typing `y` — never omits in-place work.

- 4addd9d: feat(driver-sql)!: organization-scoped uniques are NULL-safe — `COALESCE(organization_id, '__global__')` key part + `unique: 'organization'` on declared indexes (ADR-0120 D3/D4, #5030)

  SQL UNIQUE is NULL-distinct, so the `(organization_id, field)` composite #3696
  introduced enforced **nothing** on rows whose organization is NULL — which on a
  single-tenant stack (where the kernel injects the column and never fills it) is
  **every row**: field-level `unique: true` was a silent no-op there, measured in
  #5030. Per ADR-0120 D3, every organization-scoped unique now materializes its
  organization key part as `COALESCE(organization_id, '__global__')`: NULL-organization
  rows collapse into one platform bucket, unique among themselves; non-NULL rows
  are untouched. Storage stays NULL — the sentinel exists only inside the index
  key, and it is the same word the autonumber sequence table already uses
  (`GLOBAL_TENANT`), so a constraint-violation error reads as "the platform
  bucket collided", not as corrupt data.

  What changes, concretely:

  - **Field-level `unique: true`** (and the new explicit synonym
    `'organization'`) on a tenant-scoped object → composite
    `(COALESCE(tenantField, '__global__'), field)`. `unique: 'global'` and
    tenant-less objects are unchanged.
  - **Declared indexes gain the ADR-0120 D1 scope vocabulary at the driver**:
    `unique: 'organization'` prepends the NULL-safe organization key part to the
    listed columns (degrading to the listed columns on a tenant-less object; a
    listed tenant column is made NULL-safe in place instead — the S6 respelling).
    `unique: true` / `'global'` on a declared index stays **verbatim** — the
    #3696 contract, now the `'global'` arm; the nine engine dedup/idempotency
    keys keep their exact physical shape. (The spec/lint side of the vocabulary
    lands separately via #4986; the driver deliberately merges first.)
  - **Drift detection reads both sides through one normalization**
    (the #4884 discipline, extended to the tenant key part): the physical
    `COALESCE(organization_id, <literal>)` form is attributed to the column,
    compared **literal-agnostically**, and recognised as the sync's own
    vocabulary — a healthy database reports zero drift on every dialect.
  - **Existing bare composites migrate through the ceremony (ADR-0120 D4)**:
    `(organization_id, X) → (COALESCE(organization_id, '__global__'), X)`
    surfaces as a `recreate_index` drift op — a pure tightening — gated by a
    **duplicate pre-flight probe**. Clean probe → the op grades `safe` and dev
    `autoMigrate: 'safe'` / a plain `os migrate apply` applies it. Duplicates
    (data the void constraint wrongly admitted) → the op is **blocked** with a
    per-group row report, the old index stays in place, and apply re-probes so
    even `--allow-destructive` cannot drop a constraint whose replacement is not
    creatable. Deduplicate, re-plan, apply.
  - **`'__global__'` is reserved at the organization-minting seam**
    (plugin-auth): an organization whose id or slug equals the sentinel is
    rejected at creation with a prescriptive error (ADR-0120 D3 guardrail).

  Migration note for operators: on databases with pre-existing
  organization-composite uniques, the first `os migrate plan` after upgrading
  shows one `recreate_index` per affected index. On healthy data it auto-applies
  in dev and is a no-op content-wise; a blocked op means the #5030 defect
  admitted real duplicate rows — resolve the listed rows first. MySQL < 8.0.13 /
  MariaDB cannot express the functional key part: the driver degrades to the
  bare composite, says exactly what is not enforced at `error` level, and keeps
  reporting the tightening as drift for after the server upgrade.

- 82397b6: feat(drivers,objectql): `$regex` / `$options` are refused everywhere, and `$icontains` is implemented on the SQL family (#5702)

  The driver half of the #4706 ruling. #5701 landed the contract (the vocabulary,
  the `RETIRED_FILTER_OPERATORS` prescriptions, the shared text case-set) and
  #5710 flipped the last live producer — `plugin-auth`'s ObjectQL adapter, which
  emitted `$regex` on the authentication path — so the refusal can now land
  without breaking sign-in.

  **BREAKING for anyone writing `$regex` or `$options` in a filter.** Both are
  refused on every backend with `INVALID_FILTER` / 400 and a message that names
  the replacement. `$regex` was never a declared operator: `driver-sql` compiled
  it to a LIKE-escaped substring (so `a.b` matched only the literal `a.b`),
  `driver-memory` ran it as a real `RegExp` (so the same filter also matched
  `axb`, and an _invalid_ pattern was caught and answered `false` — zero rows, in
  silence), and `objectql`'s `having` did the same. Write `$icontains` for the
  case-insensitive substring search this was almost always used for, `$contains`
  for a case-sensitive one; a pattern that genuinely needs a regex has no
  filter-level replacement.

  **`$icontains` now runs on the SQL family** — `driver-sql`, `driver-sqlite-wasm`,
  and both of `driver-turso`'s transports (the remote one does not go through
  knex, so it needed its own). It compiles to `LOWER(col) LIKE LOWER(?) ESCAPE ?`
  through the same `applyLike` / `pushLike` that carries the `%` / `_` / `\`
  escaping, as a `fold` parameter rather than a second emitter — a copied emitter
  is where the escape class would have been dropped, and an unescaped `%` matches
  every row. An empty or non-string comparand is refused on the validating walk
  (an empty one matches every row, which widens rather than narrows). On SQLite
  `lower()` folds ASCII only, which IS the contract (#4706 Q1 = A): `$icontains:
'café'` does not match `CAFÉ`.

  <!-- adr-0087: registered filter-regex-options-retired -->

  `driver-mongodb`'s unknown-operator arm was throwing a bare `Error` with no
  `code` and no `status`, three lines from the helper in its own file that sets
  `INVALID_FILTER` / 400 — a 500-shaped body for a 400-class client mistake. It
  now speaks the same envelope as its three siblings.

  Two parts of the ruling are deliberately NOT in this change and stay tracked in
  `scripts/check-driver-conformance.mjs`'s ledger: the `$contains` family's
  case-sensitivity (#4706 Q2 = A) needs SQLite's `LIKE` replaced by a case-exact
  construct in the driver, the RLS lowering and the analytics lowering together,
  or one permission rule compiles to two row sets (#6518); and `$icontains` on the
  JS evaluation faces needs the spec vocabulary to take the operator, which cannot
  happen before `driver-memory` has an arm for it (#6520).

- 3264516: fix(driver-sql,service-analytics)!: 两类无意义比较对象不再编译成「静默空谓词」——`$in`/`$nin` 的对象成员与 LIKE 族的对象比较值一律拒收 (#5234)

  两个形状此前都**编译通过、执行、并给出一个作者没写过的答案**,而且没有任何东西记录这件事:

  | filter                             | 改前                                                                                   | 改后                                               |
  | ---------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
  | `{status: {$in: ['a', {foo: 1}]}}` | 该成员绑不上任何行,查询答得**就像第二个成员从没被写过**                                | `INVALID_FILTER` / 400,点名 `index 1`              |
  | `{status: {$nin: [{foo: 1}]}}`     | `NOT IN ('[object Object]')` —— **一行都没排除**,作者写下的排除悄悄没发生              | 同上                                               |
  | `{name: {$contains: {}}}`          | `LIKE '%[object Object]%'` —— 对一行文本恰好是 `[object Object]` 的记录,**真的命中了** | `INVALID_FILTER` / 400,点名 `StringOperatorSchema` |
  | `{name: {$notContains: {}}}`       | 反过来:为一个没人记录的理由**排除了一条真实记录**                                      | 同上                                               |

  #5041(PR #5223)在 `assertCompilableComparand` 的头注释里把这两个形状写为 "Deliberately NOT
  extended",理由是它们 fail-closed(只收窄结果集)、比 #5041 实测的裸 `TypeError` 低一级。**实测下来这
  两条理由都不成立**:`$nin` / `$notContains` 方向是**放宽**(该排除的没排除,在 read-scope 下即 #5347 /
  #5324 判过的 over-reach);而 `$contains: {}` 给的从来不是「零行」,是**错行**。

  ## 三份实现一起动,否则修完仍是方言

  同一个 `String()` 宽容在本仓有多份;只收紧 `driver-sql` 会变成「哪个面接的就是哪个答案」——
  #5146 / #5332 / #5567 各花一轮消掉的那类分叉。守卫因此落在**每个包自己的收口点**,而不是三个发射器:

  - **`driver-sql`** —— `assertCompilableComparand`,#5041 已有的那一个门。
  - **`service-analytics` 的 `where` 门** —— `filter-normalizer.ts` 的 `fieldLeaves`。它是本包**唯一**的
    leaf 生产者,所以一处拒收同时覆盖三个消费方:`NativeSQLStrategy`(真正执行的语句)、
    `ObjectQLStrategy.generateSql`(`/analytics/sql` 回显)与 `ObjectQLStrategy.convertFilter`(引擎路径)。
    这个顺序是关键而非顺手:`convertFilter` 是**生产者**,在那里 `String()` 会把对象洗成一个类型完全正确
    的 `'[object Object]'` 字符串交给驱动,下游再严格的驱动也永远看不到它该严格的那个形状。
  - **`service-analytics` 的 read-scope 门** —— `read-scope-sql.ts` 的 `compileOperator`,它编译的
    `FilterCondition` 不经过上面那个门。

  `like-pattern.ts` 与 `applyLike` 里的 `String(value)` **原样保留**:它们不再是缺陷所在,因为门前已经没有
  渲染不出来的值能到达。两包的谓词由 `like-metacharacter-escape.test.ts` 逐值互锁——正是该文件已经用来锁
  转义表达式的同一套办法。

  ## 围栏是 allow-list,而且每一条都是实测后决定的

  抄 `driver-turso` `RemoteTransport` 的形状(cloud#1004 / #1058):deny-list 会把下一个被发明出来的值形状
  悄悄放进来,这正是那个 bug 熬过第一次修复的原因。顺带说明,**turso 自 #1058 起就已经拒收这两个形状**,
  所以本地 SQLite 与远程 SQLite 此前对同一条查询给的是不同答案;本次改动把它们收敛到一起。

  留在围栏内的(逐条实测,不是假设):

  - **数字 / 布尔 / `null`**:`{$contains: 5}` → `%5%`、`{$contains: null}` → `%null%` 在 `driver-sql`、
    `driver-memory` 与 analytics 两个面上**今天答案一致**,#5526 还专门把 `null` 这条钉住了。拒收它们是在
    **破坏**一致,不是建立一致——所以只拒**对象**。
  - **`Date`**:turso 的 allow-list 把它作为唯一的对象转换保留,拒收会重新叉开本地与远程。
  - **binary**:`$in` 成员照收(`isBindableComparand` 与写路径 `formatInput` 同一套分类),LIKE 拒收——它
    绑得上但渲染不出作者想要的东西。这就是两个谓词而不是一个带 flag 的原因。
  - **`undefined`**:不可授权(JSON 没有 `undefined`),analytics 门按 #5526 / #5332 归一为 `null` 而非拒收;
    在 `driver-sql` 拒收它会**造出**一个分歧而不是消除一个,故照旧。

  被拒的**数组**是本次唯一一个「拒收即消分叉」的形状:`{name: {$contains: ['al','be']}}` 在 `read-scope-sql`
  (与 `driver-sql`)绑 `%al,be%`,在 analytics 的 `where` 门却绑 `%al%`(它读 `values[0]`,后面的成员被
  静默丢弃)。同一个包对同一条 filter 有两个答案,两个门现在都拒。

  ## 作者需要知道的迁移

  这两个形状本来就没有能用的读法——`filter.zod.ts` 的 `StringOperatorSchema` 早就把 LIKE 族比较数声明为
  `z.string()`,本次只是让声明变成强制(Prime Directive #12,declared = enforced)。改后它们答 400 而不是
  一个错答案;把比较数换成字面值即可。`{$eq: {…}}` **不在本次范围**,仍按 `toSqlBindValue` 绑 JSON(#5526
  钉住的行为)。

- f1544e2: feat(driver-sql): compile `$field` to a column-to-column comparison on SQL push-down (#5222)

  `FieldReferenceSchema` (`{ $field: 'other_column' }`) is declared in the spec and
  genuinely PRODUCED — `compileCelToFilter` emits it whenever a CEL permission/RLS
  rule compares one field to another — but its only implementation was the
  in-memory evaluator. #5041 measured the consequence and installed a loud refusal
  (`INVALID_FILTER` / 400, replacing a bare `TypeError` and, inside an `$in` list,
  a silent zero-row answer), deliberately leaving the capability itself to this
  change. Until now, therefore, one permission rule had two behaviours chosen by
  whether the query reached a database.

  The six scalar comparison operators — `$eq` / `$ne` / `$gt` / `$gte` / `$lt` /
  `$lte`, including the array-triple authorings that lower to them — now compile
  `{ $field: 'col' }` into a real column reference:

  ```js
  {
    amount: {
      $gt: {
        $field: "budget";
      }
    }
  } // → where "amount" > "budget"
  ```

  **Nothing that worked before changes.** This is additive: every shape that
  compiled still compiles identically, and the refusal gate was NARROWED, never
  removed. A minor bump because a previously-400 filter now returns rows.

  **The refused arm, and why each entry is there** (all keep `INVALID_FILTER` /
  400):

  - **Dotted paths** (`{ $field: 'account.owner_id' }`) — maintainer ruling: v1 is
    same-table columns only. No JOIN planning, no alias-qualified columns.
  - **Undeclared columns**, on either side — the `$field` value lands in a SQL
    identifier position, so only fields the object declares are accepted, refused
    at COMPILE time rather than by the database. Federated/external tables
    (ADR-0015), whose column set this driver does not own, are refused wholesale.
  - **The tenant-isolation column**, on either side — a privilege-escalation
    comparison surface. Closed on both sides because the operands of `=` commute.
  - **Cross-class comparisons** (a number against text, a date against text) —
    SQLite orders by storage class first while the in-memory evaluator applies JS
    coercion, so the two paths genuinely disagree and neither answer can be made
    the other. Refused rather than shipped as a silent divergence.
  - **`$in` / `$nin` / `$between` list members** — the in-memory evaluator does not
    resolve a reference inside a list either (`resolveValue` returns an array
    unchanged), so there is no correct semantics for SQL to be equivalent to.
  - **The string operators** (`$contains`, `$startsWith`, …) — a column-side LIKE
    pattern cannot be metacharacter-escaped portably, and an unescaped one is the
    `%`-matches-every-row filter bypass.
  - **The bare `{ field: { $field: 'other' } }` spelling** — what
    `parseFilterAST(['a', '=', { $field: 'b' }])` lowers to. Still refused, because
    the in-memory evaluator answers `false` for it rather than reading it as an
    equality; the refusal now names `$eq` as the spelling that compiles instead of
    falling through to a generic operator list.

  **Equivalence is proven, not asserted.** A cross-path conformance suite runs each
  supported shape through the in-memory evaluator AND through SQL push-down against
  the same seeded rows, holding both to the same declared id list. Its fixture
  carries every NULL arrangement two columns can be in — target NULL, referent
  NULL, and BOTH NULL — because three-valued SQL against a two-valued JS matcher is
  the one place these paths can genuinely diverge. Every emitted predicate is
  therefore written TOTAL: `{ a: { $eq: { $field: 'b' } } }` matches a row where
  both columns are NULL, which a plain `a = b` would drop, and `$not` over any
  cross-field leaf is its exact complement.

  The suite runs the full driver axis — SQLite always, live Postgres and MySQL
  when the runner provisions them — and on both SQL drivers: `driver-sqlite-wasm`
  inherits the compiler but executes through its own sql.js dialect, which binds
  the identifier list itself. The dialect axis is not ceremony here: a cross-field
  predicate is the one filter shape whose SQL carries two identifiers and no bound
  value, and the class rule has a different failure per backend — comparing text to
  a number is a silent wrong answer on SQLite (storage classes order before values)
  but `operator does not exist: text > integer` on Postgres. The guard is what
  keeps either from being reached.

- 7457a09: fix(driver-sql): give the bounded connection attempt an accurate error message (#3769)

  #3781 bounded a connection attempt at 10s via `pool.createTimeoutMillis`, which
  stopped the 30s hang but kept knex's own wording: `Timeout acquiring a
connection. The pool is probably full`. The pool is not full — the server never
  completed the handshake — so that message sends an operator to tune `pool.max`
  while the network is what is broken. This is the same defect class the boot
  guard in #3741 was about: an error that reads nothing like its cause.

  `SqlDriver` now also sets the **dialect's own** connect timeout, which fails with
  a message that names what happened:

  | client                                           | key                       | message             |
  | ------------------------------------------------ | ------------------------- | ------------------- |
  | `pg` / `postgres` / `postgresql` / `cockroachdb` | `connectionTimeoutMillis` | `timeout expired`   |
  | `mysql` / `mysql2`                               | `connectTimeout`          | `connect ETIMEDOUT` |

  Carrying the timeout requires `connection` to be an object, so a URL string is
  moved into the dialect's URL slot (`connectionString` for pg, `uri` for mysql2).
  Verified against a black-holing listener that both forms still reach the URL's
  own host/port and still honour `?sslmode=require`. SQLite is untouched — opening
  a file has no handshake to time out.

  **The two bounds are deliberately unequal.** They race and knex wins a tie, so
  equal values would let the pool timeout fire first and the accurate message would
  never be seen. The dialect timeout is the effective bound at **10s**; the pool
  timeout is a strictly looser backstop, raised from 10s to **15s**, reached only
  by a dialect with no connect-timeout knob or one that ignores the one we set.

  `driver.config` keeps the shape the author passed — the rewrite applies only to
  what knex receives. Two existing readers depend on that: `serve.ts`'s startup
  banner and `createDatabase()`, which parses the URL to swap in the maintenance
  database. A test pins it.

  `createDatabase()`'s own admin connection now gets the same bound; it is opened
  during boot against the very server we already suspect is unreachable, so it must
  not be the one place that still waits 30s.

  **Migration.** None for a healthy datasource. A deployment that deliberately
  needs longer than 10s to establish a connection (a slow cross-region replica)
  sets `connection.connectionTimeoutMillis` (pg) or `connection.connectTimeout`
  (mysql2) explicitly, and it is left alone.

- c53aa53: File-backed SQLite now runs `journal_mode = WAL` (#3941).

  `SqlDriver.connect()` set `auto_vacuum` and left the journal mode alone, so
  every ObjectStack SQLite database ran SQLite's built-in default — a rollback
  journal. That is the worst mode for the shape this platform actually has, which
  is **several processes on one file**: a dev server, `os migrate`,
  `os meta resync`, a test run. Measured, on the same file:

  |                                                | rollback journal                                   | WAL                                                               |
  | :--------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------- |
  | writer while another process holds a read open | `SQLITE_BUSY` — committing needs an exclusive lock | proceeds                                                          |
  | idle attached connection visible to SQL        | no — a lock lasts only as long as its transaction  | yes (`locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` reports busy) |

  The second row is why the `os migrate` occupancy check had to inspect file
  descriptors to see a live server at all (#3940): under a rollback journal there
  was nothing in the database to see. That signal stays — it names the process,
  which WAL's lock probe cannot — but the SQL probe is now authoritative for
  databases ObjectStack created rather than a fallback that was blind in practice.
  Concurrent _writers_ still serialize; SQLite allows one at a time in any mode.

  Journal mode is a persistent property of the file, so an existing database is
  converted in place on the next connect (a header change — no rows are touched)
  and stays converted. Two consequences to plan for:

  - `app.db-wal` / `app.db-shm` exist beside the database while a connection is
    attached, and `app.db-wal` can hold committed transactions. A clean shutdown
    checkpoints them away; a naive copy of `app.db` alone while a server runs does
    not. Use `sqlite3 app.db ".backup …"`.
  - **WAL does not work on network filesystems** (NFS/SMB). Opt out with
    `OS_DATABASE_SQLITE_JOURNAL_MODE=delete`, or per datasource with
    `sqliteJournalMode: 'delete'` in the driver config (which outranks the env
    var). Either form _applies_ `delete`, so it also converts a database that
    already adopted WAL back — skipping would have stranded it.

  Nothing here fails a boot, and nothing is assumed: `PRAGMA journal_mode = X`
  answers with the mode actually in force rather than raising on refusal, so the
  reply is read back; and because a filesystem can accept WAL and then fail the
  first read _through_ it, the mode is proven with a read and rolled back to
  `delete` if that fails — with a warning naming the file and the escape hatch.
  `synchronous` is untouched, so durability is exactly what it was. `:memory:`
  databases are left alone, as is `auto_vacuum = INCREMENTAL`, which keeps
  reclaiming under WAL (ADR-0057).

  `os db clean` now counts `-wal` / `-shm` as part of the database when it measures
  what a `VACUUM` reclaimed, so bytes that were sitting in the log do not read as a
  reclaim of zero.

  `@objectstack/driver-sqlite-wasm` deliberately stays out of WAL. Its live
  database is in the WASM heap and what reaches disk is a byte image it exports, so
  nothing reads the database across processes and the pragma buys it nothing —
  while still being a persistent header change in the operator's file. sql.js
  _accepts_ the pragma (its VFS is memory-backed), so this had to be declared
  rather than discovered.

  It also now parks a `-wal` left behind by an unclean native-driver exit rather
  than loading the image beside it: wasm SQLite cannot read that log, and leaving
  it next to a freshly rewritten image would let a later real SQLite replay frames
  that no longer belong to it. The warning names the file it parked and how to
  recover what was in it.

- 3172831: fix(drivers): text-operator case folding is the CONTRACT's answer, not the dialect's (#6518)

  The `$contains` family and `$icontains` returned **different rows on different
  databases** for the same filter, because case sensitivity was decided by whatever
  `LIKE` happened to mean on the dialect underneath. Both directions **over-matched**
  — they returned rows the filter excludes, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter (#3948):

  |                              | `$contains` / `$notContains` / `$startsWith` / `$endsWith` — case-SENSITIVE (#4706 Q2 = A) | `$icontains` — folds ASCII ONLY (#4706 Q1 = A) |
  | :--------------------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------- |
  | SQLite / turso / sqlite-wasm | ❌ `LIKE` folds ASCII                                                                      | ✅ `lower()` is ASCII-only                     |
  | Postgres                     | ✅ `LIKE` is case-exact                                                                    | ❌ `LOWER()` folds all of Unicode              |
  | MySQL                        | ❌ follows the column's collation                                                          | ❌ `LOWER()` folds all of Unicode              |

  Read across: **each dialect was already right on the half another one got wrong**,
  which is why neither half could be found from one backend alone.

  ## What now runs

  The construct is chosen per dialect, in one emitter, so the escaping and the fold
  stay a single code path (an unescaped wildcard is a filter bypass, P0 — #5567):

  - **SQLite family → `GLOB`.** `LIKE`'s ASCII fold cannot be switched off per
    statement (`PRAGMA case_sensitive_like` is connection-global, so one query would
    redefine every other query on the connection), and `CAST(col AS BLOB) LIKE ?` was
    measured to match _nothing at all_. `GLOB` is case-exact and brings its own
    escaped class — `*`, `?`, `[` as the self-closing classes `[*]`, `[?]`, `[[]`,
    because SQLite's grammar gives `GLOB` no `ESCAPE` clause. `$icontains` keeps
    `lower()` on both operands, still ASCII-only.
  - **Postgres → `LIKE`, unchanged.** Only the fold moved, from `LOWER()` to an
    explicit `translate()` over the 26 ASCII letters. Measured on a live PostgreSQL
    16 (ICU database): `LOWER('CAFÉ')` is `'café'` — the over-fold — while the
    `translate()` form leaves `É` alone.
  - **MySQL → `LIKE` over `CAST(… AS BINARY)`**, so the comparison is byte-wise and
    no collation decides the case; `$icontains` folds byte-wise over the same binary
    rendering, which is ASCII-only because UTF-8 is self-synchronising.
  - **Any other client** keeps the previous `LIKE` / `LOWER()` shape — it is the only
    form that still runs there — and is recorded as residue rather than left to be
    discovered.

  `driver-turso`'s remote transport carries the twin (it compiles filters itself and
  inherits nothing), and the two transports are now held to the same rows by a
  parity suite that runs the shared `FILTER_TEXT_CASES` on both.

  ## Behaviour change — read this before upgrading

  A filter whose comparand's case did not match the stored text used to match on
  SQLite/turso/sqlite-wasm and may have matched on MySQL. It no longer does:

  ```ts
  // rows: { id: '1', name: 'ACME Corp' }, { id: '2', name: 'acme corp' }
  {
    name: {
      $contains: "acme";
    }
  } // was ['1','2'] on SQLite → now ['2'] everywhere
  {
    name: {
      $icontains: "acme";
    }
  } // ['1','2'] — unchanged, and now correct on PG/MySQL too
  {
    name: {
      $icontains: "café";
    }
  } // was ['3','4'] on PG/MySQL → now ['4'] everywhere
  ```

  If you were relying on `$contains` to ignore case, **write `$icontains`** — that is
  the operator for it, and it now folds the same ASCII-only range on every backend.
  Result sets only ever get NARROWER, never wider, so a filter that was already
  correct stays correct.

  ## Why `minor` rather than `major`

  No declared surface moves. `$contains` still exists, still takes the same
  comparand, and `filter.zod.ts` is untouched — the case-sensitivity this delivers
  was **already published** as the contract by #5701 (`FILTER_TEXT_CASES`, one
  release earlier in this same v17 major), and the drivers were the half that had
  not caught up. This is Prime Directive #12 applied in the direction it points:
  declared = enforced. It is graded the way its sibling #5702/#6549 was graded for
  the same operator family in the same rc cycle, and it registers nothing in the
  ADR-0087 registries because it retires no authorable key.

  ## What is deliberately NOT in this change

  `driver-memory` and `driver-mongodb` still fold case on their query paths — they
  are the #5499 frozen family, so their `FILTER_TEXT_CASES` cells stay honest DEBT
  and are tracked as #6682 (case sensitivity) and #6520 (`$icontains`). The
  `service-analytics` SQL compilers were measured already compliant: they emit
  Postgres-shaped statements, where `LIKE` is case-exact, and that assumption is now
  written down and pinned rather than implied.

- b90086a: fix(driver-sql)!: `unique` materializes per tenant, ending its contradiction with the per-tenant autonumber sequence (#3696)

  `unique: true` became a **single-column global index that ignored `tenancy`
  entirely**, while the autonumber sequence table is keyed by
  `(object, tenant_id, field, scope)` and hands every tenant its own counter
  starting at 1. Two subsystems of the same platform contradicted each other:
  tenant B's `PROD-00001` was rejected by an index it could not see — **no user
  did anything wrong**, the platform's left hand refused what its right hand
  issued.

  The rejection also doubled as a **cross-tenant existence oracle**: a UNIQUE
  violation told tenant B that some _other_ tenant held the value, enumerable by
  probing emails / codes / names.

  **The contract now:**

  | Declaration                      | Materializes as                                                 |
  | -------------------------------- | --------------------------------------------------------------- |
  | `unique: true` + tenant column   | composite `(tenantField, field)` — unique **within** the tenant |
  | `unique: true`, no tenant column | single-column — single-tenant DDL is byte-identical to before   |
  | `unique: 'global'`               | single-column, always platform-wide                             |

  The tenant column comes first in the composite, so the index also serves the
  `WHERE tenant = ?` prefix scans every tenant-scoped read issues.

  **Declared `indexes[]` are deliberately unchanged.** They are materialized over
  exactly the columns listed — no tenant column is injected. The author already
  spells them out, per-tenant ones have always been written explicitly
  (`fields: ['organization_id', 'code']`), and many are legitimately platform-wide
  (a DNS hostname, a reserved slug, an external provider id). `'global'` is
  accepted there as a synonym of `true` so one vocabulary covers both spellings.

  **Migration is automatic and cannot fail.** Legacy indexes
  (`<table>_<col>_unique` from knex, `uniq_<table>_<col>` from the drift-rebuild
  path) are retired inline at schema-sync time. The old global constraint is
  strictly stronger than the new per-tenant one, so existing rows satisfy the
  replacement by construction — no dedup, no cleanup, no data touched. It
  converges at sync rather than waiting for a deliberate `os migrate` run because
  a deployment that never ran migrate would otherwise stay broken.

  **Upgrading — audit your `unique: true` fields.** On a tenant-scoped object the
  constraint is now per tenant. Anything that must stay platform-wide has to say
  so:

  ```ts
  hostname: Field.text({ unique: "global" }); // no two tenants may claim it
  ```

  Note the reach: `applySystemFields` injects `organization_id` into every
  registered object unless it opts out, and the driver falls back to that column
  when no `tenancy.tenantField` is declared — so most objects are tenant-scoped.
  Typical candidates for `'global'`: DNS hostnames, reserved slugs, external
  provider ids (Stripe customer/subscription), device identities.

  Postgres materializes `col.unique()` as a table CONSTRAINT rather than a bare
  index, so the retirement tries `DROP CONSTRAINT` before `DROP INDEX` —
  `DROP INDEX` alone would have made the migration a no-op on exactly the
  deployments that matter most.

  `@objectstack/driver-mongodb` accepts the new declaration but keeps single-field
  indexes: it implements no row-level tenancy at all (no tenant predicate on read,
  no tenant stamp on write), so a `(tenant, field)` index would advertise an
  isolation it does not deliver. Tracked separately.

- ea90179: fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

  Four independent surfaces where the answer a caller received contradicted the
  contract the surface declares. All four were found driving a real showcase boot
  against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

  - **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
    refusing to run untrusted code that asked for a capability it does not hold,
    which is the crash contract's case (#3951), not a deliberate rejection of a
    malformed request. It now answers 500, and the `SandboxError:` debug prefix
    no longer reaches the client.

  - **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
    write path returned `record: null` / `success: true` for an id that resolves
    to nothing, while GET on the same id correctly 404s; `deleteMany` reported
    every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
    can no longer read a successful envelope as proof the write landed.

  - **#4436 — the unsupported-filter-operator refusal shipped without
    `error.code`.** A refusal with no code is unmatchable by a client, and the
    message leaked the internal `[sql-driver]` prefix. It now speaks
    `INVALID_FILTER` without the driver prefix.

  - **#4483 — the `$search` auto field set admitted its lead field
    unconditionally.** `nameField`/`name`/`title` were prepended without passing
    `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
    The lead field now only ORDERS the set it is already a member of; it can no
    longer admit one.

  These change responses that were observably wrong, so callers coded against the
  buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
  see different status codes. Graded `minor` on that basis rather than `patch`.

- a5dcb74: fix(driver-sql,driver-turso): a cross-field `$field` refusal stops naming the two columns it compared (#7929, #7988)

  `INVALID_FILTER` / 400 is unchanged, and every filter that was refused is still
  refused. What the caller no longer receives is the **predicate**: the referenced
  column, the target column, the operator, the list index, and the boundary reason.
  The full diagnostic now goes to the driver's server-side log instead
  (`SqlDriver.logger`, the sink a host already injects; `TursoDriver` hands the
  same sink to its remote transport).

  **Why.** An administrator's CEL sharing/permission rule compiles to
  `{ $field: path }` and is ANDed into the caller's query by the security
  middleware (ordinary CRUD reads) or by the analytics read-scope merge. The driver
  receives one `FilterCondition` with nothing marking which subtree the caller
  wrote, so when the reference failed one of the four cross-field rulings the
  refusal handed a tenant an administrator's policy — measured end to end: the
  referenced column, the column it was compared against, and, on the tenant arm,
  a sentence naming **which column is the tenant-isolation column** of the object.
  A dotted reference came back as `sharing_rule.manager_budget`, verbatim, inside
  `error.message`.

  **⚠️ This is a real diagnostic regression for authors, and it is deliberate.**
  An author debugging their **own** cross-field filter now gets the same redacted
  message — nothing in the query tells the driver whether the reference was theirs
  or a policy's, so the withhold cannot be conditional without inventing a guess.
  Their message is not destroyed, it is relocated: the full text, naming both
  columns, is in the server log for whoever operates the deployment. A follow-up
  card restores the author-facing text behind a spec-declared provenance mark set
  at both merge boundaries; until it lands, an author debugging a cross-field
  filter needs the server log or a `matchesFilter` run in memory.

  What a caller still gets: the same `code` and `status`, which of the three
  cross-field refusal classes fired, and the capability statement (same-table
  declared columns, same type class, tenant-isolation column excluded) — none of
  which is derived from the filter that was sent.

  Scope note: five operators used to answer a `{ $field }` comparand with their own
  comparand-shape refusal (`$icontains`, `$like`/`$ilike`, `$null`, `$exists`),
  each rendering the reference into its message, while the same reference at
  `$contains` was answered by the cross-field refusal. They now all answer with the
  cross-field refusal — one condition, one answer, and the redacted one.

### Patch Changes

- fa3d0cf: feat(spec): field runtime value-shape contract — ADR-0104 phase 1 (D1)

  `@objectstack/spec/data` now owns the runtime VALUE shape of every field type
  (`field-value.zod.ts`): semantic type classes (`STRING_VALUE_TYPES`,
  `NUMERIC_VALUE_TYPES`, `REFERENCE_VALUE_TYPES`, `FILE_REFERENCE_TYPES`,
  `STRUCTURED_JSON_TYPES`, `MULTI_CAPABLE_TYPES`, …), the shared
  `isMultiValueField`, and `valueSchemaFor(field, 'stored' | 'expanded')`. The
  four consumers that each hand-copied this knowledge (objectql record-validator,
  rest import-coerce, driver-sql column classification, qa conformance) now
  derive from the spec, and the field-zoo round-trip MATRIX is asserted against
  the contract so the two cannot drift.

  **Write-path change (objectql, warn-first):** previously-unvalidated types —
  single `lookup`/`master_detail`/`user`/`tree`, `file`/`image`/`avatar`/
  `video`/`audio`, `location`, `address`, `composite`, `repeater`, `record`,
  `vector` — are now checked against the contract. A violation **logs a warning
  and passes** in this release (legacy rows must not strand their records);
  set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` to enforce as a
  `400 VALIDATION_FAILED`. The flip to strict-by-default rides a later minor
  (ADR-0104 R1/R2).

  **Deprecations (removal rides the next spec major), FROM → TO:**

  - `CurrencyValueSchema` (`{value, currency}`) → none. A `currency` field's
    value is a **bare number** everywhere in the runtime (validator, SQL `float`
    column, import coercion, field-zoo oracle); the currency code lives in field
    config. Use `valueSchemaFor({type: 'currency'})`.
  - `LocationCoordinatesSchema` (`{latitude, longitude}`) → `LocationValueSchema`
    (`{lat, lng}`) — the shape the platform actually stores.
  - `AddressSchema` is **adopted** (unchanged) as the enforced `address` value
    contract via `AddressValueSchema`.

  No stored data changes shape; the contract codifies deployed reality
  ("reality wins", ADR-0104 D1).

- 28ad90e: feat(types,cloud-connection,lint,cli): ADR-0120 17.x 收尾 —— `isolated` 安装期姿态硬门(D5e)、D5c 重拼写 advisory、成文契约扫荡与三姿态 conformance (#5081)

  ADR-0120 17.x 波的第三块,也是最后一块。前两块已在 main 上:#5212(driver 侧
  D3+D4 —— `COALESCE(organization_id, '__global__')` 物化、drift 两侧同步、重复预检)
  与 #5208(spec 词汇 `'organization'` + D5a/D5b lint)。本次补齐三件事:安装期的
  姿态决策点、剩余的成文契约、以及把「一个 app 包跑遍三种姿态」从假设变成测试。

  **D5e —— 装进 `isolated` 环境时的硬门。** 词汇本身是姿态无关的:作者说的是业务
  边界(`'organization'` 一个组织一份 / `'global'` 整个安装一份),没有任何索引形状
  读姿态。唯一的残留在一个方向上:`isolated` 下组织就是**不同客户**,此时 app 业务
  对象上的 `'global'` 唯一既跨客户过度约束,又变成跨客户的存在性预言机(S10/S14)。
  维护者裁定这是**硬门而非 advisory**:把带 `'global'` 唯一(非 `sys` 对象)的 app
  装进 `isolated` 环境会**停下来并逐索引列出**,安装者(通常是 AI agent)要么确认它
  确实是平台级的,要么改写为 `'organization'`;确认按 ADR-0104 attestation 风格
  留痕在安装清单里(`InstalledManifestEntry.globalUniqueAttestation` —— 确认了什么、
  谁确认的、何时、在哪个姿态下问的),**之后不复问**。

  - 停下的安装**什么都不留**:先于 hot-register 和任何 ledger 写入,所以作者改完
    元数据可以直接重试,不需要先卸载。
  - 逐索引确认是有牙齿的:`confirmGlobalUniques` 收 `true` 或明确的 id 数组,只确认
    其中一条仍会在剩下的那条上停住。
  - 升级引入的**新**约束会被问,老的答案继续算数。
  - 另一个姿态下给出的确认**不算同意** —— `isolated` 那个问题在 `single` 下从未被
    问过,所以按「未确认」处理(唯一不会静默放行跨客户约束的方向)。
  - ⛔ **永不做成启动期告警**(#4884 纪律)。boot 时的 rehydrate 不评估此门;门够不到
    的两类存量 —— 门禁上线前的安装、装后姿态变更的环境 —— 由 `os doctor` 与
    `os migrate plan` 的 advisory 形态覆盖。

  判定里有三条是承重的,别「简化」掉:声明索引上的裸 `unique: true` **算**(D1 说它
  就是 `'global'` 的位置式拼写,排除它等于让整个 17.x 可以靠拼写绕过);字段级
  `true` **不算**(它是 `'organization'`,永久合法);`sys_`/`base_` 对象**不算**
  (S5 那批引擎幂等键天然就是平台级的,每次安装都问一遍就是 #4884 的误报类)。

  CLI: `os package install` 新增 `--confirm-global-uniques`,并把 409 渲染成可读的
  逐条清单而不是一句 "Install failed (409)"。

  **D5c —— 遗留手写组织复合索引的 advisory。** 新规则
  `unique/legacy-organization-composite`:声明的唯一索引自己列出了组织列
  (`{ fields: ['name','organization_id'], unique: true }`)—— 这是词汇出现之前手写
  per-organization 的写法。它读起来像「每组织唯一」,物化出来却是普通复合索引,而
  SQL UNIQUE 是 NULL-distinct 的:组织列为 NULL 的行上它**什么都不约束**(#5030),
  在单组织部署上那就是每一行。改写成 `unique: 'organization'`(`fields` 原样保留,
  driver 会把已列出的组织列**就地**变成 NULL-safe 形式)正是补上这个洞的动作。
  **永远只是 advisory,永远不自动修**:老拼写永久合法、零强制 drift,而 opt-in 是
  真实的物理收紧,要走 D4 的 `recreate_index` + 重复预检。

  **D6 —— 成文契约扫荡。** `content/docs/data-modeling/indexing.mdx` 的
  §Two ways to say "unique" 全节按新词汇重写(含 `os:check` 代码块);
  `content/docs/protocol/objectql/schema.mdx` 的 §Uniqueness and tenancy 重写为
  §Uniqueness and scope —— 其中那句「单租户部署不受影响,租户列是常量,复合索引
  退化为单列索引」是 #5030 **证伪过的原话**,现已替换为 D3 的 NULL-safe 事实;
  `content/docs/deployment/cli.mdx` 的 `replace_unique_index` / `recreate_index`
  条目补上 NULL-safe 形状与重复预检;`content/docs/references/**` 经
  `gen:schema && gen:docs` 再生成,未手改。

  按 ADR-0120 Resolved #2 的非规范性引导(官方示例/脚手架/生成器在新代码中输出
  显式拼写),`skills/objectstack-data/**` 的索引与校验规则整体扫过:声明索引一律
  说清 scope,并新增一节完整讲 `'organization'` 的 NULL-safe 语义与「永远不写姿态」。
  顺带修掉那里长期使用的 `tenant_id` —— 平台的列叫 `organization_id`。
  `examples/**`、`create-objectstack` 模板与 `os generate` 经核查**根本没有声明任何
  唯一约束**,故无可扫;这是核查结论,不是遗漏。

  **三姿态 conformance(ADR §Acceptance tests)。** 同一个 fixture app 在
  `single | group | isolated` 三姿态下启动,逐 S 行用**真实的违规插入**断言 enforcement
  (S1/S2/S3/S4/S5/S6/S7/S8/S9/S11/S12),并逐姿态捕获物化出的索引键,断言三者
  **逐字节相同** —— 「没有任何索引形状读姿态」这句话一旦有两者不同就是假的。相同性
  断言配了一条正向断言(对着期望的键形状),这样「三次都什么都没建」不会读成「一致」。
  外加 ADR 只要的那一条 transition smoke:在 `single` 下建库、`isolated` 下重新打开,
  drift op 为零。

  对既有部署的影响:除新增的安装期确认外,本次不改变任何已有物化行为。字段级
  `unique: true` 一如既往合法。

- c7f4417: fix(driver-sql,analytics): stop `aggregate()` / `distinct()` leaking SQLite's raw epoch storage (#3797)

  Both returned `await builder` directly, without the `formatOutput` pass every
  `find()` row gets. On SQLite — the one dialect where a `Field.datetime` is
  stored as INTEGER epoch milliseconds rather than a native timestamp — that raw
  storage form went straight to the caller:

  | call                                   | before                       | after                            |
  | -------------------------------------- | ---------------------------- | -------------------------------- |
  | `find()`                               | `"2026-01-10T09:00:00.000Z"` | unchanged                        |
  | `distinct('closed_at')`                | `[1768035600000]`            | `["2026-01-10T09:00:00.000Z"]`   |
  | `aggregate()` `max(closed_at)`         | `1768035600000`              | `"2026-01-10T09:00:00.000Z"`     |
  | `aggregate()` `groupBy: ['closed_at']` | key `1768035600000`          | key `"2026-01-10T09:00:00.000Z"` |

  Same root cause as #3773, different exit. `Field.date` was never affected — it
  is ISO TEXT on every dialect, so its storage form already equals its
  presentation.

  The visible surfaces were a `_max`/`_min` measure over a datetime (a "last
  closed" KPI tile rendered `1768035600000`) and a `groupBy` on a raw datetime
  dimension, which also disagreed with the in-memory `applyInMemoryAggregation`
  fallback — that one consumes already-formatted `find()` rows, so the same
  dataset changed key type depending on which path served it.

  Which columns hold an instant is now recorded while the statement is built,
  because that is the only point where a column name and its meaning are both
  known: a `min()` lands under its alias and never under the field name, while a
  date-BUCKETED column lands under the field name but holds a label (`'2026-01'`)
  rather than an instant. Matching on names afterwards gets both backwards.

  `distinct()` additionally re-deduplicates after presenting: SQL `DISTINCT`
  compares STORED values, and one SQLite datetime column holds both INTEGER and
  TEXT forms, so two rows recording the same instant survived as two and then
  presented identically. It has no in-repo callers today; this keeps it honest
  rather than leaving a second convention in the driver.

  **`cross-object-rebucket` was fixed alongside it, because presenting min/max
  correctly is what exposed it.** `recombine()` coerced every operand with
  `Number()`, which silently depended on receiving an epoch: handed the ISO string
  the driver now returns it produced `NaN`, and on Postgres/MySQL (where knex
  returns a `Date`) it had always flattened the value back to an epoch integer one
  layer above the driver. `min`/`max` now order by the instant and return the
  winning value in the shape it arrived in; `sum`/`count` stay numeric.

- ecb39ea: fix(driver-sql): the first concurrent autonumber insert from two tenants no longer fails on Postgres with `25P02` (#8269)

  On Postgres, two tenants inserting into the same autonumber-bearing object **for
  the first time concurrently** failed the whole batch with `25P02 current
transaction is aborted, commands ignored until end of transaction block`. The
  counters advanced anyway, so the numbers that attempt had reserved were lost —
  a permanent gap at the start of both tenants' sequences. The user-visible story
  was _"creating the first records failed; I retried, it worked, and my numbering
  starts at 0004."_

  `getNextSequenceValue` handled the first-insert race the way the idiom is
  usually written — catch the unique violation, then recover **on the same
  transaction**:

  ```ts
  try {
    await trx(SEQUENCES_TABLE).insert({ ...insertRow, last_value: initial });
  } catch (err) {
    existing = await trx(SEQUENCES_TABLE).where(key).forUpdate().first(); // 25P02
  }
  ```

  On Postgres any statement error aborts the entire transaction, so the recovery
  `SELECT … FOR UPDATE` **is** the statement that raises the error — the recovery
  path could never run there. SQLite and MySQL do not abort on a statement error,
  which is why the pattern looked correct, and why the SQLite-backed autonumber
  suite could not catch it.

  Both speculative statements now run under a `SAVEPOINT`, released on success and
  rolled back to on failure, so a failed attempt leaves the surrounding
  transaction usable on every dialect. The race handler that was written for this
  case now actually runs: the loser of the first-insert race blocks on the
  winner's row, reads the committed counter, and takes its number from the UPDATE
  path.

  **Scope of the second site.** The `SELECT … FOR UPDATE` fallback a few lines
  above had the same shape and the same consequence. Its comment attributed it to
  dialects that "reject `.forUpdate()` on a missing row" — measured on
  `postgres:16`, that does not happen (a missing row returns zero rows), but the
  catch is reachable for lock-level failures (deadlock `40P01`, lock/statement
  timeout `55P03`/`57014`), and each of those was being masked as an
  uninformative `25P02` by the fallback read. It is now under the same savepoint.

  **Not multi-org-only.** The report measured single-tenant bursts as safe; they
  are only _flakier_. Measured before the fix, 5 rounds each of one tenant × N
  cold concurrent inserts failed 0/5 (N=2), 1/5 (N=4), 3/5 (N=6) and 2/5 (N=12)
  with the same `25P02`. Two tenants means two cold counter rows, which makes the
  window near-certain to be hit rather than occasional — an amplifier, not a
  precondition. Single-organization deployments were exposed too.

  Unchanged: what happens to numbers on a failed attempt. The reservation still
  commits in its own transaction and is not rolled back with the caller's insert,
  which is ordinary sequence semantics. SQLite and MySQL behaviour is unchanged —
  the savepoint makes Postgres behave the way they already did.

- ddd075a: refactor(spec,objectql,driver-sql): the autonumber counter readback is one shared pure function, beside the renderer it inverses (#6560)

  `packages/spec` gains `readAutonumberCounter(value, prefix, suffix)`, the declared
  inverse of `renderAutonumber`, and both consumers call it instead of holding their
  own copy.

  **Why the inverse belongs where the composition already lives.** `renderAutonumber`
  composes `prefix + zero-padded(seq) + suffix` and its file header states it is
  "shared by the ObjectQL engine and the SQL driver so both paths render identical
  record numbers". PR #6553 (#6468) had to teach both seeding paths to read a counter
  back out of a stored value — and landed that reading as two hand-written copies of
  the same four lines, one in `packages/objectql`, one in
  `packages/drivers/driver-sql`. That is the exact shape of the defect those copies
  were fixing: two independent readings of one composition rule had already drifted
  into two _different_ wrong answers over one dataset (`001-2026` read as `2026` by
  the engine and `12026` by the driver), so the record-number band a tenant received
  depended on which driver happened to run, and numbers burned that way cannot be
  reclaimed. A cross-package `runtime` parity test caught the drift once; it does not
  force a future single-side edit to run it.

  **What moved and what did not.** Only the ANCHORED rule — the one both sides must
  apply identically — is now spec's: the counter is the digit run at the start of
  what follows the rendered `prefix`, after stripping the rendered `suffix` when the
  value carries it (stripped when it matches, never required to match, since one
  counter spans the years a dynamic suffix renders). Out-of-scope values read as
  `undefined`, which also gives the SQL driver back its JS-side re-check of a `LIKE`
  that matched looser than `startsWith` under a case-insensitive collation.

  The UNANCHORED case (neither affix declared) stays per-side, because the two sides
  deliberately differ there and #6553 preserved both byte-for-byte: the engine reads
  the last digit run, the driver concatenates every digit. Spec returns `undefined`
  rather than pick one — a shared contract that claimed an agreement which does not
  exist would be worse than no shared contract. Each side documents its own fallback
  at its own call site.

  **Zero behaviour change.** Every call site keeps its existing guards and its
  existing result for every input; the `packages/runtime` cross-side parity suite that
  pins the two seeding paths against each other is unmodified and passes as-is, which
  is the evidence the semantics moved without changing. Per the maintainer's ruling on
  #6560 (2026-08-08, twice, re-confirmed 2026-08-10): a non-authorable export — no
  Zod, no new vocabulary, no acceptance-face change — so this is api-surface
  bookkeeping plus two call-site swaps.

- db12b88: refactor(driver-sql): read the autonumber default from the contract instead of a hardcoded fallback (#7263)

  Execution half 3/3 of the maintainer's route-3 ruling on #6555. `{0000}` is now a
  declared contract default (`DEFAULT_AUTONUMBER_FORMAT`, landed with
  `resolveAutonumberFormat` in `@objectstack/spec/data`), so this driver stops
  writing the default down for itself.

  Two sites in `sql-driver.ts` — `initObjects` and the external-object
  registration path — each spelled the same four lines by hand:

  ```ts
  const rawFmt =
    typeof field.autonumberFormat === "string" && field.autonumberFormat
      ? field.autonumberFormat
      : typeof field.format === "string" && field.format
      ? field.format
      : "";
  const fmt = rawFmt || "{0000}";
  ```

  Both are now `const fmt = resolveAutonumberFormat(field);`. That is the whole
  change: one symbol added to an import this file already had, no new dependency,
  and the `#1603` comment about honouring both spellings retired to the resolver's
  own docstring, which carries it.

  **Behaviour-neutral, by construction and by measurement.** `resolveAutonumberFormat`'s
  precedence — canonical `autonumberFormat`, then the `format` shorthand, then the
  declared default, with anything that is not a **non-empty string** counting as
  undeclared — was deliberately taken from these very lines, including their
  truthiness rule (not the engine's `??`). A differential check over 484 field
  documents, spanning both spellings across 22 value shapes (absent key,
  `undefined`, `null`, `''`, non-empty strings, numbers, booleans, `NaN`, arrays,
  objects, a boxed `String`, `Symbol`, function, `BigInt`), found the old
  expressions and the resolver returning the identical string in every case —
  `format: ''`, `autonumberFormat: ''` and the non-string values included, not just
  the happy path.

  Compatibility note, per the ruling: choosing {0000} keeps stored driver-sql data
  undisturbed; engine-fallback deployments flip from bare 1 to 0001 for newly
  issued numbers. Counter continuity itself is unaffected (#6468 pinned it).

  The engine half of the same ruling is #7262; #6555 stays open until it lands, so
  a format-less field still renders `0001` on SQL and a bare `1` on the engine's
  in-memory fallback until then. This half moves neither.

- 62452c6: docs(driver-sql): state the autonumber contract — unique and monotonic per scope, NOT gapless (#8283)

  An autonumber's gap behaviour was undocumented, so the only way to learn it was
  to hit it. A write rejected for a reason unrelated to the autonumber still
  consumes the number it reserved: `TK-0001`, a failed insert, then `TK-0003`
  (measured on both SQLite and Postgres). Nothing was wrong with that — it is
  ordinary sequence semantics — but nothing said so, which is exactly the
  ambiguity that gets a gapless series promised to a customer.

  **The contract, now stated in the driver's TSDoc beside the existing "an
  autonumber is an immutable business identifier" sentence.** Per counter — the
  `(table, tenant, field, scope)` key `getNextSequenceValue` issues from — an
  autonumber is **unique** (no two rows get the same value), **monotonic** (each
  value issued exceeds the last), and **NOT gapless** (the series may skip values,
  permanently). A rejected write — a unique violation on another field, a
  validation rule, a throwing `beforeInsert` — burns its reserved number, and the
  next write gets the one after it.

  The reservation is committed by `getNextSequenceValue` in **its own
  transaction** (`runner.transaction` over `parentTrx ?? this.knex`), deliberately
  independent of the caller's insert, which is why a later failure cannot take it
  back; inside a caller transaction it nests and rolls back with the refused
  insert, so that path burns nothing. The comment says this is by design and asks
  the next reader not to "fix" it.

  **Behaviour is unchanged — this release is a comment and this changeset.** The
  maintainer ruled on 2026-08-13 (#8283) that documenting the contract is the
  close: reserving the number only after the row is known to be insertable was
  rejected (it narrows gaps without closing them — a post-reservation crash still
  burns one — and would have to compose with the savepoint structure at both
  speculative sites), and an opt-in gapless mode is recorded as a restart
  condition for the first compliance-grade gapless requirement, not built.

  Consumers who need the same statement in author-facing documentation: the
  `content/docs/data-modeling/**` half is tracked separately as #8479 and is not
  in this change.

- 6f6fec7: fix(objectql,driver-sql): 自增号播种按声明的 `suffix` 定位计数器,两侧收敛到同一答案 (#6468)

  `autonumberFormat` 允许序号槽 `{0..0}` **后面**还有 token —— `renderAutonumber`
  专门返回 `suffix`,其契约就是 `prefix + zero-padded(seq) + suffix`。这类格式渲染
  出的值**序号不在串尾**:`{000}-{YYYY}` 渲染成 `001-2026`,是很常见的单号写法。

  两侧的播种解析却都假定「串尾的数字就是计数器」,而且各错各的:

  - 引擎兜底播种 `seedAutonumber()` 取整串的**最后一个**数字段 —— 读到的是年份。
    库里三行 `001-2026`/`002-2026`/`003-2026`(真实计数器 3)把计数器播种成 **2026**,
    下一个发出的号直接跳到 `2027-2026`;
  - driver-sql 的 `scanMaxNumericTail()` 把 tail 里**所有**数字拼接后 `parseInt` ——
    同样三行读成 **12026**,下一个号是 `12027-2026`。

  于是**同一份元数据、同一批行,换个驱动号段就不一样**;中间跳过的号已经烧掉,事后
  无法回收。只修一侧会把「两个不同的错误答案」变成「一个对一个错」,跨驱动仍不一致,
  所以两侧同 PR 修。

  **修法:两侧解析器尊重已声明的 `prefix`/`suffix`。** 两个字符串都由调用方从
  `renderAutonumber` 的返回值取得后传入 —— 两侧都不再自行理解格式,driver-sql 只收
  参数(`getNextSequenceValue` 仅多转发一个位置参数,序列逻辑本身未动):

  - **prefix / suffix 任一非空 ⇒ 计数器「有锚」**:取 prefix 之后的**首个**数字段,
    并在该行确实带有声明的 suffix 时先把它去掉;
  - **两者皆空 ⇒ 「无锚」**:各自的既有读法**逐字保留**(引擎取整串最后一个数字段,
    driver-sql 拼接全部数字)—— 无 `{0..0}` 槽的格式渲染的就是串尾裸计数器,而早于
    格式存在的历史值根本没有锚可依。

  **suffix 只在匹配时剥离,绝不要求匹配。** `{000}-{YYYY}` 的计数器 scope 是渲染后的
  **prefix**(此处为空),即全局一个计数器、只有显示的年份在变,所以去年的 `007-2025`
  持有计数器 7,必须计入。把 suffix 下推成 `like '%-2026'` 会把这些行整批漏掉、播种
  **低于**真实 max —— 那正是 #6249 修掉的重复单号伤害,自己再造一遍。因此 SQL 谓词
  保持 `like 'prefix%'`,suffix 只在 JS 侧逐行使用。

  无后缀格式(`D-{0000}`、`{0000}`)两侧本来就正确,行为不变并已 pin 住;#6467 的
  播种扫描结构未触碰。

- 7d1ff75: fix(driver-sql): re-seed a stale autonumber counter instead of burning a number per failed create (#5495)

  `getNextSequenceValue` bootstraps a counter from the data-table `MAX` exactly
  once, in its `if (!existing)` branch; after that the data table is never
  consulted again. Any row landing by a path that bypasses `fillAutoNumberFields`
  — an `isSystem` seed replay, a `preserveAudit` historical import (both
  strip-exempt under #5503 and keeping their explicit numbers), or direct SQL —
  therefore never raises the sequence, and once the counter sits below `MAX` it is
  permanently behind. Every subsequent create collided, burned a number and failed
  the request, until the counter had ground past the seeded range one 409 at a
  time. That is the "one-time storm per database" the filing reported from
  HotCRM's 17.0 GA sweep: 25 consecutive `409 UNIQUE_VIOLATION`s with the
  attempted number climbing by one per failure.

  Measured on `main` @ `86e6f6c`, counter seeded at 10 with rows 11–39 landed by a
  bypass path: **29 caller-visible 409s before a create succeeded** at
  `CASE-00040` on attempt 30. After this change the same fixture serves
  `CASE-00040` on the caller's **first** attempt, and `last_value` reaches 40 by
  one re-seed rather than 29 burns.

  `create()` now re-seeds the counter from the data-table `MAX` and retries
  (bounded, 3 attempts) — but only when it can _prove_ the collision was that
  counter's.

  **Why the proof is not the conflicting column.** The obvious predicate ("retry
  when the conflicting column is this autonumber field") needs
  `uniqueViolationColumn()` (#6544) to name a column, and on a tenanted autonumber
  it never does — for two independent reasons, both measured and both pinned by
  tests. The filing's own message is a composite
  (`UNIQUE constraint failed: crm_case.organization_id, crm_case.case_number`),
  which that export refuses by contract; and what this repo builds today is
  narrower still — ADR-0120 D3 makes the index
  `(COALESCE(organization_id,'__global__'), field)`, an _expression_ index, on
  which SQLite reports `UNIQUE constraint failed: index 'uniq_…'` and names no
  column at all. The "column not determinable" limb is not an edge case on this
  path; it is the only limb that ever runs there.

  All three of `uniqueViolationColumn()`'s states are handled explicitly, because
  collapsing any two of them silently is how a real 409 gets eaten:

  1. a column is named and it is one this driver generated → re-seed and retry;
  2. a column is named and it is not → the duplicate is on a value the **caller**
     supplied, so the original error is rethrown untouched;
  3. no column is determinable → decided from the **data**, not the message: if
     the value this driver just generated is already present in the same tenant
     partition the counter covers, the collision was the counter's. If it is not,
     the error is rethrown. One indexed lookup, on the failure path only — the
     happy path is unchanged.

  No fifth dialect word-list: the judgement is `isUniqueViolationError` +
  `uniqueViolationColumn` from `@objectstack/types`, per Prime Directive #12 and
  the #5841 precedent. The re-seed's `MAX` scan is deliberately not wrapped in a
  `catch`, so a read failure propagates instead of being folded into `0` or a
  stale value (#6114's rule, #5979's family).

  Retrying is confined to the no-caller-transaction case. Inside a caller's
  transaction the sequence `UPDATE` shares that transaction and rolls back with
  the refused `INSERT`, so no number is burned (measured), and on Postgres a
  constraint failure aborts the transaction outright — the caller owns that retry.

  The `getNextSequenceValue` docstring is reconciled rather than left to
  contradict the code: a rolled-back insert burning a number is still by design,
  and that sentence used to read as though it also covered a _persistently
  failing_ insert, which was the defect.

  Inherited by `TursoDriver` (local/replica) and `SqliteWasmDriver`, each pinned
  by its own test rather than assumed from the base class (#6203). Turso's
  **remote** transport is unaffected in both directions: it overrides `create` and
  never enters `fillAutoNumberFields`, so it has neither the defect nor the fix.

- 0af50a3: fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

  A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
  lower bound and was silently wrong for an upper one: the dashboard date-range
  filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
  `datetime` column every row created after 00:00 of the `to` day vanished from
  the result — no error, the chart renders, the numbers are just smaller. The
  default configuration hit it: the filter's default field is `created_at`
  (a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

  The translation is operator-sensitive and half-open, applied at every
  comparison emitter:

  - `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
    bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
    in the column's storage form; `$between [min, max]` with a bare-day max
    decomposes to `>= min AND < next-day(max)`. Both the plain and the
    legacy-repair (mixed-storage) column paths, both `where` spellings.
  - `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
    instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
  - The `/analytics/sql` rendering and the dataset preview evaluator apply the
    same rule, so the echoed SQL and drafted numbers reproduce execution.

  `@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
  the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
  `Date`s and impossible days are never widened).

  Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
  (`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
  (instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
  those). No authored metadata changes: a dashboard's existing
  `{ $gte, $lte }` window now simply includes its final day.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 7e5af5c: feat(spec): the filter comparand-type door (#7872) — the shared compile face now defines the accepted literal comparand-type set as the measured superset `string | number | bigint | boolean | null | Date` and refuses everything else loudly (`INVALID_FILTER` / 400), for every driver at once.

  Previously the five drivers answered an unsupported comparand type five ways (measured, #7956): the SQL family refused by policy, driver-memory crashed on `BigInt` (a raw mingo `TypeError`) and silently answered zero rows for five other types, and driver-mongodb let the BSON encoder silently edit the query — `{qty: undefined}` reached the wire as `{}`, i.e. MATCH EVERYTHING.

  What changes for callers:

  - `parseFilterAST` (`@objectstack/spec/data`) now judges everything it returns — the object-form passthrough included — and the ObjectQL engine runs the same walk on object-form filters at its lowering seam, covering every engine verb on both doors. New exports: `normalizeFilterComparandTypes`, `isAcceptedFilterComparand`, `ACCEPTED_FILTER_COMPARAND_TYPES`, `ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE`, `FILTER_COMPARAND_BIGINT_EXACT_LIMIT`, and the `FILTER_COMPARAND_TYPE_CASES` conformance table all five driver suites now run.
  - A filter carrying `undefined`, a function, a `Symbol`, a `Map`/`Set`/class instance, or a plain object in a scalar operator slot is now refused with `code: 'INVALID_FILTER'`, `status: 400`, and guidance naming the accepted set — it previously crashed, answered a silent wrong row count, or matched everything, depending on the driver.
  - A `bigint` comparand is accepted and narrowed copy-on-write to its exact JS number at the door (so it now works on driver-memory too, instead of crashing); a bigint beyond ±2^53 is refused loudly instead of silently losing precision.
  - `FieldReference` comparands (`{ $field: … }`), nested-relation/deep-equality structure, arrays outside `$in`/`$nin`/`$between`, and unknown/retired operators are deliberately untouched — their recorded rules and refusals stand.
  - driver-sql and driver-turso source their comparand allow-list membership and refusal wording from the door instead of keeping local copies; their envelopes and direct-caller behavior are unchanged.

- e120a5a: feat(drivers): lower `count_distinct` on the SQL family (#6409)

  `count_distinct` has been declared by `AggregationFunction` since the enum was
  written, and until now no SQL backend compiled it: both faces of the SQL family
  refused it with `NOT_IMPLEMENTED` / 501. A dashboard measure asking for a
  deduplicated count against a SQL datasource got a capability-gap refusal for a
  query that was already correct.

  This is the ENFORCE half of #6188's split ruling (maintainer, 2026-08-07).
  `array_agg` and `string_agg` took ADR-0049's remove leg and left the enum in
  protocol 17 — no SQL backend compiled them and `string_agg` had no single shape
  to lower to. `count_distinct` was deliberately kept on the other side of that
  split, on the strength of having exactly one portable lowering. That lowering
  now exists:

  - **`driver-sql`** — `SqlDriver.aggregate` emits `count(distinct "column")`, on
    every dialect the driver targets.
  - **`driver-turso`** — `RemoteTransport.aggregate` emits the same, on the remote
    path. Both faces in one change, deliberately: `TursoDriver` picks between them
    from `url`, so a lowering that landed on one alone would mean one query
    answering two ways depending on a connection string.

  **Semantics: distinct NON-NULL values of the target column** — the standard
  `COUNT(DISTINCT col)` answer, and the same one `objectql`'s in-memory fallback
  and `service-analytics`'s SQL strategy already give.

  **`field` is now required for `count_distinct`.** `AggregationNodeSchema` makes
  `field` optional because `COUNT(*)` is a real spelling, but `COUNT(DISTINCT *)`
  is a syntax error in every dialect. A `count_distinct` aggregation with no
  `field` is refused up front with `INVALID_QUERY` / 400 and a message naming the
  fix, rather than being sent to the database and coming back as an opaque 500.
  Plain `count` with no `field` still means `COUNT(*)`, unchanged.

  **The refusal message no longer names `count_distinct` as unsupported.** Both
  faces build their "Compiled here:" list from their lowering table, so the
  message now lists it among the functions that work. With this entry the declared
  aggregate vocabulary and the SQL family's compiled vocabulary are the same set.

  **New shared conformance table.** `AGGREGATION_CASES` / `AGGREGATION_ROWS`
  (`@objectstack/spec/data`) is the standard both SQL faces are now run against —
  values over one fixture carrying duplicates and nulls, so a lowering that lost
  the dedup or counted NULL as a value fails on a number rather than passing a
  SQL-string assertion. `driver-memory` and `driver-mongodb` are inside the #5499
  freeze and are not enrolled; the table records what each would answer and why,
  rather than omitting them.

- 42e3b01: fix(driver-sql): `Field.date` + `defaultValue: 'NOW()'` records the UTC calendar day on Postgres/MySQL (#4022)

  The bare `CURRENT_TIMESTAMP` default resolved the calendar day in the SERVER's
  timezone on Postgres — measured: a UTC-12 server recorded yesterday; an
  Asia/Shanghai server records tomorrow for every default after 16:00 UTC — and
  MySQL 8.0 rejects it on a DATE column outright (MariaDB is merely permissive,
  and the driver's UTC-pinned session masked the semantic half there).
  `nowColumnDefault` now emits a UTC expression default on both dialects, the
  #3994 D-C3 construction one type over. Defaults only govern newly created
  columns; existing columns keep their legacy default, per the standing D-B3
  policy.

- a52e2ef: fix(driver-sql,spec,objectql): a `defaultValue` runtime token never becomes a column DEFAULT (#4560)

  `Field.user({ defaultValue: 'current_user' })` is resolved by the **engine**, at
  insert time, from the request's `ExecutionContext` — and with no authenticated
  user (system / anonymous writes: seed replay, package install, boot
  provisioning) `applyFieldDefaults` deliberately leaves the field **unset**
  rather than stamp a bogus owner.

  The SQL DDL had never heard of the token. `createColumn` passed any non-object
  `defaultValue` straight through to `col.defaultTo(dv)`, so the column was
  created as `DEFAULT 'current_user'` and the **database** overrode the engine's
  decision: every insert that omitted the field stored the literal string
  `current_user` in a `lookup('sys_user')` column — a value that is not any user's
  id. `?expand` resolves it to nothing, and on an owner / approver field it is a
  silent mis-attribution. Found by #4551's dangling-reference audit on its first
  run against a real boot; #4441's referential check could never have caught it,
  because it inspects the values a **caller** supplied and here nobody supplied
  one.

  **The token vocabulary is now declared once, in `@objectstack/spec/data`**
  (`DEFAULT_VALUE_TOKENS`, `isRuntimeDefaultToken`, `isNowDefaultToken`,
  `isCurrentUserDefaultToken`, `isAppResolvedDefaultToken`). The engine's
  insert-time resolution and the driver's DDL read the same set, which is the
  actual defect: `'NOW()'` was special-cased in the branch immediately above for
  precisely this reason, and `current_user` — the same convention family — simply
  had no entry anywhere the DDL could see. A token added to the set tomorrow is
  excluded from literal column DEFAULTs automatically, rather than leaking its own
  spelling into the database the way this one did.

  **DDL, in one place** (`applyDeclaredColumnDefault`, shared by column creation
  and the SQLite table rebuild):

  - `'NOW()'` → the driver-native canonical default, exactly as before;
  - any other runtime token → **no column default at all** (the engine owns it);
  - Expression envelopes (`{ dialect, source }`) → unchanged, no default;
  - a real literal → emitted verbatim, unchanged.

  **Existing databases carry the wrong DEFAULT**, so it is corrected through the
  managed schema-drift path (#2186) rather than a bespoke migration: a new
  `default_mismatch` finding with a `drop_column_default` op, categorised `safe`
  (the statement cannot fail and touches no rows). Dev boots with
  `autoMigrate: 'safe'` reconcile it automatically; everywhere else it is reported
  with an actionable hint and applied by `os migrate apply`. Postgres/MySQL use
  `ALTER COLUMN … DROP DEFAULT`; SQLite, which cannot alter a default in place,
  goes through the existing table rebuild — which now re-materialises every
  column's default from **metadata**, so a sibling `defaultValue: 'NOW()'` column
  keeps the default it always had instead of losing it to the rebuild.

  **Rows already holding the bogus value are NOT rewritten.** That is #4551's
  standing rule — report, never rewrite — so they stay visible to the
  dangling-reference audit for operators to resolve deliberately.

- 39eb01b: fix(driver-sql): a currently-declared unique index is never legacy debt — index drift no longer ping-pongs (#3955)

  An object may declare both a tenant-scoped field-level `unique: true` and an
  object-level single-column unique index on the same column:

  ```ts
  email: Field.email({ unique: true }),
  indexes: [{ fields: ['email'], unique: true }],
  ```

  The declared index materializes under `buildIndexName` as
  `uniq_<table>_<column>` — which is also one of the two spellings
  `legacyUniqueIndexNames` looks for when hunting pre-#3696 platform-wide
  uniques. The detector therefore read an index the current metadata declares
  as legacy debt and proposed replacing it with the tenant composite (which
  the same sync had already created).

  The resulting plan never converged: `apply` dropped the declared index, the
  next `plan` reported it missing and recreated it, and the one after that
  called it legacy again — an unbounded drop/create cycle on a live unique
  index, every round rendered as a "safe" change.

  `legacyUniqueReplacements` now takes the object's `declaredIndexes` and
  filters their normalized names out of the legacy candidate set, so an index
  metadata declares today is never mistaken for debt. Genuinely legacy indexes
  are still retired, including the knex-spelled `<table>_<column>_unique` when
  only the `uniq_…` spelling is declared.

- 4384921: fix(spec,drivers): `bypassTenantAudit` becomes a declared driver option, and `findOne` stops accepting a bare id (#4311)

  Three drivers built with `tsup` and tested with `vitest`, so no `tsc` had ever
  read them. Onboarding them to the #4311 type-check ratchet surfaced 292 errors,
  and most of what looked like sloppy test fixtures was the types being wrong.

  **`DriverOptions.bypassTenantAudit` is now declared.** It has been live for a
  long time without being on the schema: `SqlDriver.auditMissingTenant` reads it
  to suppress the "tenant-scoped write without `tenantId`" warning, the driver's
  own warning text tells callers to set it, `ObjectQLEngine` sets it for
  system-context calls, and `service-settings` / `service-datasource` pass it on
  every global-scope write. Because the schema never had it, the driver read it
  through `(options as any)` and no caller was type-checked. The declaration
  states the limit as well: it silences a diagnostic and MUST NOT change which
  rows a write touches — suppressing an audit warning is not a permission.

  The same cast covered `timezone`, `tenantId`, `tenantIds` and `preserveAudit`,
  all long since declared. Those reads now go through `DriverOptions`, so the next
  undeclared option fails the build instead of hiding behind an existing cast.

  **`SqlDriver.findOne(object, id)` is removed.** An undeclared
  `typeof query === 'string' | 'number'` branch accepted a bare id. It was on no
  contract, nothing outside that package's own tests used it, and the other two
  drivers answered the identical call differently — `MemoryDriver` spreads the
  string into `{0:'t',1:'1'}`, `MongoDBDriver` reads `query.where` as `undefined`
  and returns an arbitrary row. It also bypassed the shared `findRows()` path, so
  it skipped field selection, temporal coercion, unknown-column recovery and the
  `singleRowLookup` ORDER BY decision. Spell an id lookup as the query it is:

  ```ts
  -(await driver.findOne("task", "t1"));
  +(await driver.findOne("task", { object: "task", where: { id: "t1" } }));
  ```

  **`SqlDriver.initObjects` declares the `tenancy` it consumes.** Each object is
  fed to `computeAndRecordTenantField`, which reads `obj.tenancy` to pick the
  tenant column and to set or clear the sticky explicit-opt-out — but the
  parameter type listed only `{ name, fields }`, so a caller that spelled the key
  correctly was rejected while the driver read it anyway.
  `registerExternalObject` already had it.

  **`AnalyticsQueryInput` joins `AnalyticsQuery`.** `timezone` is
  `.default('UTC')`, so the parsed type requires it and an authored literal does
  not have it — the same two-tier split `QueryInput`/`QueryAST` already names on
  the query side. `InMemoryDriver.create`/`bulkCreate` also declare their
  `IDataDriver` return types; without them TS inferred the literal the method
  builds and every other column of the created row disappeared from the caller's
  view.

  One silent runtime bug fell out of the same pass: a driver test asked for
  `orderBy: [['id', 'asc']]`, the driver reads `item.field`, a tuple has none, and
  the sort never reached SQL. The tuple spelling appears nowhere else.

- 45e711a: fix(driver-sql): `bulkCreate` and `upsert` re-seed a stale autonumber counter instead of burning the whole batch (#6943)

  #5495 taught `create()` to re-seed a stale autonumber counter and retry instead
  of burning one number per failed insert. `bulkCreate()` and `upsert()` call the
  same `fillAutoNumberFields` and did not get that fix. They are not, however, the
  same defect as each other — measured on `main` @ `c8ff269`, on a fresh database
  with seeded rows above the counter (the one-time-storm repro constraint #5495
  established):

  **`upsert` is `create()`'s old shape exactly.** Single row, so a stale counter
  costs it one burned number per call: `last_value` walked 1 → 2 → 3 across two
  refused upserts. Its `ON CONFLICT (mergeKeys) DO UPDATE` absorbs a conflict on
  the merge key only; the tenanted autonumber lives under a _different_ unique
  index, so that violation is still raised and still reaches the caller.

  **`bulkCreate` is worse.** Each row reserves its number in its own committed
  transaction and the batch then goes in as ONE insert, so a single colliding row
  burns _every_ number the batch reserved and fails the whole request:

  | 3-row `bulkCreate`, counter at 10, rows 11–39 already present | before                | after                   |
  | :------------------------------------------------------------ | :-------------------- | :---------------------- |
  | caller-visible failures                                       | both calls threw      | **0**                   |
  | rows written                                                  | **0**                 | 3                       |
  | `last_value`                                                  | 10 → 13, then 13 → 16 | 10 → 42, by one re-seed |

  And it is the worst path to leave without recovery: framework#2678 made
  `bulkCreate` the common case for seed/import, and seed/import is exactly what
  _creates_ the staleness — an `isSystem` replay or a `preserveAudit` import keeps
  its explicit numbers and never enters `fillAutoNumberFields` (#5495/#5503).

  Both paths now reuse #5495's machinery unchanged — `collidingAutoNumberReservations`
  for the three-state routing, `autoNumberValueExists` for the data-based
  discriminator (the conflicting column is never determinable for a tenanted
  autonumber), and the forward-only `resyncSequenceToDataMax`. A collision that is
  not provably this counter's is still rethrown untouched, so a duplicate on a
  value the caller supplied still reaches them as its own error.

  **Batch semantics are unchanged, and that is a measurement rather than a
  choice.** `insert(rows[])` is a single statement, so the batch was already
  all-or-nothing — the failed batch above left the table exactly as it found it.
  Re-issuing and retrying the whole batch therefore preserves the existing
  contract: no partial success is introduced, no transaction is opened, and no
  "does a failed row roll back its siblings" question arises, because siblings
  already fail together. Per-row retry inside the batch was rejected for the
  opposite reason — it would have had to split the one statement into N and invent
  partial success where none existed.

  One thing the batch may not borrow from `create()`: `create()` keeps a
  reservation that did not collide, to avoid burning a second number. A batch
  cannot. One that straddles the seeded range has its low rows collide and its
  high rows not, and re-issuing only the collided ones would hand them numbers
  _above_ the kept ones — an intra-batch duplicate the driver would have
  manufactured itself. Re-issue is therefore per counter: every row drawn from a
  counter that went stale is re-issued, and counters that did not go stale keep
  their values, so a co-tenant's rows in the same batch are undisturbed.

  As with #5495, retrying is confined to the no-caller-transaction case. Inside a
  caller's transaction the sequence `UPDATE` rolls back with the refused `INSERT`,
  so nothing is burned and there is nothing to repair (measured on both paths), and
  on Postgres a constraint failure aborts the transaction outright. The caller owns
  that retry.

  `TursoDriver` (local/replica) and `SqliteWasmDriver` inherit both fixes, each
  pinned by its own test rather than assumed from the base class — Turso
  _overrides_ `bulkCreate`/`upsert` to route remote traffic away, so inheritance
  there is a routing fact, not a class fact. Turso's remote transport builds its
  own INSERT and generates no autonumber at all, so it neither has this defect nor
  receives this fix (that gap is #6944).

- 465a0fa: fix(driver-sql): refuse scalar-comparison operators on JSON/multi-value columns with 400 `INVALID_FILTER` instead of answering a silently wrong result

  A `multiple: true` field — and every other `JSON_COLUMN_TYPES` field — is stored by this driver as a **JSON TEXT** column. The equality family lowered straight to SQL against that text with no column-type consultation, so a filter naming such a column compiled, ran, and returned a wrong answer with a `200`.

  **Behaviour change (user-visible).** On a row whose `members` holds `["U1","U2"]`:

  | filter                          | before                                               | after                |
  | ------------------------------- | ---------------------------------------------------- | -------------------- |
  | `{members:{$in:[U1]}}`          | `200`, **0 rows**                                    | `400 INVALID_FILTER` |
  | `{members:{$eq:U1}}`            | `200`, **0 rows**                                    | `400 INVALID_FILTER` |
  | `{members: U1}` (bare equality) | `200`, **0 rows**                                    | `400 INVALID_FILTER` |
  | `{members:{$nin:[U1]}}`         | `200`, **the row it was asked to EXCLUDE** ⚠️        | `400 INVALID_FILTER` |
  | `{members:{$ne:U1}}`            | `200`, **the row it was asked to exclude** ⚠️        | `400 INVALID_FILTER` |
  | `{members:{$lte:U1}}`           | `200`, **1 row** (lexicographic, on the leading `[`) | `400 INVALID_FILTER` |
  | `{members:{$contains:U1}}`      | `200`, 1 row                                         | **unchanged**        |

  **`$nin` is why this is a fix and not a documented footgun.** `members not in ('U1')` is TRUE — the stored text genuinely is not equal to that id — so "exclude these" compiled to "return everything". `$in` fails **closed** (fewer rows than exist, bad but narrowing); `$nin` and `$ne` fail **OPEN**, so any exclusion built on them silently stops filtering and the failure direction is _widening_. A downstream delete-guard written as `plans.find({ where: { assignees: { $in: memberIds } } })` therefore never fired once since it shipped, threw nothing, logged nothing, and type-checked — and a `200` with `[]` is byte-identical to a query that legitimately matched nothing, so no caller had anything to key on.

  **What is refused:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$between`, the bare `{ field: value }` spelling, and the infix spellings the normalised emitter also answers (`=`, `<>`, `in`, `nin`, `not_in`, `notin`, …) — on any column this driver stores as JSON, i.e. `field.multiple` arrays **and** the structured-JSON types (`address`, `location`, `composite`, the file-metadata and multi-option types). The structured-JSON half is included because the mechanism is the JSON-text storage rather than the array-ness: `{address:{$nin:['Beijing']}}` showed the identical fail-open inversion.

  The refusal names the operator, the field, why the column cannot answer it, states that the filter **was not applied**, and prescribes the working spelling. It carries the same ADR-0112 envelope as the unknown-operator refusal (`INVALID_FILTER` / 400), on every face that lowers a filter: `find`, `findOne`, `count`, `aggregate`, `distinct`, and the where-clauses of `updateMany` / `deleteMany`.

  **What does NOT change:** `$contains`, `$notContains`, `$startsWith`, `$endsWith`, `$icontains` — the `LIKE` family matches the serialization as text, and `$contains` (or an `$or` of `$contains` for any-of) is the working membership spelling this refusal points at. `$null` / `$exists` also keep working: the column's presence is a well-formed question whatever it holds. Filters on scalar columns are untouched, and a table this driver was never told about (no registered field types) is unaffected — the gate fires only where the column is KNOWN to be JSON.

  Giving array columns a real membership operator (`$overlaps` / `$containsAny`) is a separate question about the closed `FILTER_OPERATORS` set and is deliberately not answered here.

- cf5e033: fix(driver-sql): `$or` branches AND their own contents again — every `$or` filter was widened

  `applyFilterCondition` passed `logicalOp='or'` _into_ each `$or` branch's
  recursive call. That flag is meant to decide only how a branch attaches to its
  parent builder, but inside the branch it also selected `orWhere` for the
  branch's own contents. So a branch's field keys — and the operators of a single
  field — OR-ed each other instead of AND-ing:

  | Filter                        | Compiled to           | Should be                |
  | ----------------------------- | --------------------- | ------------------------ |
  | `{$or:[{a:'x', b:'y'}]}`      | `a = 'x' OR b = 'y'`  | `a = 'x' AND b = 'y'`    |
  | `{$or:[{d:{$gte:X, $lt:Y}}]}` | `d >= X OR d < Y`     | `d >= X AND d < Y`       |
  | `{$or:[{$and:[A,B]}, {c,d}]}` | `(A AND B) OR c OR d` | `(A AND B) OR (c AND d)` |

  The Filter Protocol rule this breaks is Mongo's: **everything inside one filter
  object is AND-ed, at every depth.** A `$or` array OR-s its _branches_; it does
  not change how the contents _within_ a branch combine.

  Every miscompile widens the result set, never narrows it, so affected queries
  returned **more** rows than the filter allowed. Two shapes to re-check in your
  own metadata after upgrading:

  - **Scoping filters** that pair a discriminator with an id list per branch —
    `{$or:[{parent_object, parent_id:{$in:[…]}}, …]}` and similar — were not
    holding the pairing. Where such a filter decides visibility, it was returning
    rows outside the intended scope.
  - **Sharing-rule `criteria_json`** containing a `$or` whose branches carry more
    than one key (what a "match ANY of these groups" criteria builder emits). That
    path _writes_ `sys_record_share` grants, so any over-match materialized
    durable grants that outlive this fix — **re-reconcile those rules after
    upgrading**; the driver fix alone does not retract grants already written.

  Also affected: the abutting `$gte`/`$lt` window pattern the automation docs and
  CLI flow linter recommend for scheduled flows. Each tier degenerated to
  `d >= lo OR d < hi`, which matches every row, so multi-tier reminder flows fired
  on the whole table instead of one window.

  `driver-sql` was the sole divergent backend — `driver-memory`,
  `driver-mongodb`, the analytics `read-scope-sql` compiler and the write-side
  `matchesFilterCondition` evaluator all already AND-ed per node. Conformance
  tests now pin the same shapes across the three in-repo evaluators so they cannot
  drift apart again. `driver-sqlite-wasm` inherits the fix (it extends
  `SqlDriver`); Postgres, MySQL, SQLite and sqlite-wasm were all affected.

  The `$and` arm also now honors `logicalOp`, as `$or`/`$not` already did. Nothing
  reaches it with `'or'` once the propagation above is fixed, but the two changes
  are only correct together — leaving one combinator deaf to the flag is how the
  rules drifted apart in the first place.

- 6de592c: fix(driver-sql): judge unique violations with the shared predicate, so a Postgres index build over dirty data no longer takes the boot down (#6543)

  `syncDeclaredIndexes` has a branch whose whole job is to keep a database
  BOOTING when existing rows violate a NULL-safe unique it was asked to create
  (the #5030 defect made data): the constraint is logged at `error` as not
  enforced, and the ADR-0120 D4 drift pre-flight reports the exact conflicting
  rows. Taking the process down instead would brick the deployment.

  It decided whether it was looking at that case with a private inline regex over
  the stringified message — `unique constraint failed|duplicate entry|duplicate
key value`, the fourth hand-written spelling of this question #6250
  inventoried. That read one of the two channels drivers use, and on the DDL path
  the missing channel is the whole answer for one shipped dialect:

  | dialect  | `CREATE UNIQUE INDEX` over duplicate rows says           | old regex  |
  | :------- | :------------------------------------------------------- | :--------- |
  | SQLite   | `UNIQUE constraint failed: product.code`                 | matched    |
  | MySQL    | `ER_DUP_ENTRY: Duplicate entry 'DUP' for key 'uniq_…'`   | matched    |
  | Postgres | `could not create unique index "uniq_…"`, SQLSTATE 23505 | **missed** |

  Postgres does not reuse its DML phrasing for an index build: `duplicate key
value violates unique constraint` is what a conflicting INSERT says, while a
  conflicting index BUILD says `could not create unique index "…"` and puts the
  verdict on `error.code` (SQLSTATE `23505`) with the offending tuple on
  `error.detail`. None of the three message limbs appear in it — so on Postgres
  the branch never fired, and a database with legacy duplicates failed to start
  rather than booting with the constraint reported as unenforced.

  Both discriminators in this file now call `isUniqueViolationError` from
  `@objectstack/types`, passing the **error object** rather than a pre-stringified
  message, so `code`, `errno` and the `cause` chain are read alongside `message`:

  - the #5030 boot-survival branch above;
  - the negative limb of the MySQL functional-key-part fallback in
    `createNullSafeUniqueIndex`, which used a bare `/duplicate/i` to avoid
    degrading a conflict into a "this server rejects functional key parts"
    verdict — a message-only exclusion that did not fire on the `errno`-only
    shape mysql2 can hand back.

  `patch` rather than `minor`: no API changes, and the message spellings that
  were recognised before are a strict subset of what the predicate recognises, so
  nothing that was absorbed before is absorbed differently now. The site's own
  business logic — the `nullSafe.size > 0` guard that keeps this absorption
  scoped to the NULL-safe case, and the "already exists" race arm that runs ahead
  of it — is unchanged.

- d254421: fix(driver-sql): a merge-path `upsert` no longer rewrites an existing row's autonumber (#7011)

  Measured on a completely healthy counter, single row throughout:

  ```
  create                      → CASE-00001    last_value 1
  upsert same id (1st time)   → CASE-00002    last_value 2
  upsert same id (2nd time)   → CASE-00003    last_value 3
  ```

  `fillAutoNumberFields` reserves a number before the statement knows whether it
  will insert or merge, and the autonumber column sat in `mergeColumns` — so
  every `ON CONFLICT … DO UPDATE` wrote the freshly reserved number over the
  row's existing one, silently replacing an externally visible business
  identifier the caller never asked to change.

  Per the triage ruling on the card: an autonumber is an **immutable business
  identifier once assigned**. `auto_number` columns are now excluded from the
  merge column list, exactly like `created_at` (both are insert-only facts about
  the row's birth). After the fix the same sequence keeps `CASE-00001` through
  both upserts. The exclusion is unconditional — an explicit autonumber value in
  the upsert payload does not renumber an existing row on the merge branch
  either; `update()` writes what it is given and remains the deliberate
  renumbering path. Insert-path upserts still assign fresh numbers, and every
  non-autonumber column (including `updated_at`) merges as before.

  Deliberately out of scope (#6943's reseed family): the reservation itself still
  happens before insert-vs-merge is known, so a merge-only upsert still consumes
  one sequence value per call — now a permanent gap in the sequence rather than a
  rewrite of the row (measured post-fix: row keeps `CASE-00001`, `last_value`
  walks 1 → 2 → 3, the next inserted row gets `CASE-00004`).

  Covered faces: `SqliteWasmDriver` inherits `upsert` unchanged; `TursoDriver`
  local/replica routes its override to `super` — both pinned by their own tests.
  Turso remote (`RemoteTransport.upsert`) never enters `fillAutoNumberFields` and
  has neither the defect nor the fix. Rows already renumbered by past merges
  cannot be restored from the driver side.

- 06ba036: feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

  `TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
  `objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
  公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
  的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
  `fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
  在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

  **新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
  带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
  `RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
  驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
  不要凭据（remote 面走包内的 sqlite stub）。

  **留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
  `vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
  `MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
  一部分，只是曾经同包而已。

  **目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
  `driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
  `knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
  `repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

  这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
  迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
  filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
  `LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
  补齐工作跟踪在 #5590。

- 6f98c2d: fix(driver-sql,driver-memory): an uncompilable filter now throws instead of matching everything (#3948)

  A filter the driver could not compile was **skipped**, not rejected. No predicate
  was emitted and the query returned every row — the caller asked to filter and
  silently received the unfiltered set.

  The reachable shape is a bare comparison triple. `['close_date','before','2024-01-01']`
  arrives at a driver only when `isFilterAST()` refused it — its operator is outside
  `VALID_AST_OPERATORS`, so `parseFilterAST()` never converted it and the raw array
  was assigned to `where`. `driver-sql`'s loop then saw three _strings_, matched
  neither `and` nor `or`, and `continue`d past all three. `driver-memory` was worse:
  it cast every string to a logic keyword, opening three empty groups and returning
  `{}` — a filter matching every record.

  This is reachable from ordinary authoring, not just malformed input: `before` and
  `after` are canonical `VIEW_FILTER_OPERATORS` members that `VALID_AST_OPERATORS`
  does not accept. Eight of the nineteen canonical view operators are in that
  position, including `equals`; the others were masked only because ObjectUI's
  adapter alias table happened to cover them.

  **Behaviour change.** Both drivers now throw on a filter element that is neither a
  logical keyword (`and`/`or`) nor a condition array, and `driver-memory` throws on
  an operator it cannot express rather than dropping the condition. The nested and
  `$`-object paths already threw on the same input, so this makes the three paths
  agree. A caller that was relying on the old silence was receiving wrong results;
  the error names the operator and the offending filter.

  **`driver-memory` also gains seven operators it silently ignored:** `not_in`,
  `is_null`, `is_not_null`, `isnull`, `isnotnull`, `is_empty`, `is_not_empty` — all
  members of `VALID_AST_OPERATORS`, all previously falling through to
  `default: return null`. `is_null` narrowed nothing instead of matching null rows.
  Alias sets and semantics mirror `driver-sql`'s `whereNull`/`whereNotNull` arms so
  the two backends accept one vocabulary.

  Migration: none for well-formed filters. If a query now throws, the filter was
  never being applied — fix the operator (the message names it), or lower it to an
  AST spelling. `before` → `<`, `after` → `>`, `'not in'` → `nin`.

- ec975f1: fix(objectql,driver-mongodb)!: `findOne` must say which record it wants, and executes every option it declares (#4419)

  `findOne` reads a single row, which makes its predicate the only thing between
  the caller and _an arbitrary record_. When the predicate is missing the result is
  not `null` — it is the object's **first row**: a real, plausible-looking record
  with nothing to do with the request, which the `if (!row)` check every call site
  already has cannot catch, and which then propagates into whatever is computed
  next. Reported downstream: line items defaulting their price from the first
  product in the catalog rather than the selected one, and "is this deal already
  closed?" answered against an unrelated record while the write that followed
  correctly targeted the intended id. A throw would have been caught in
  development; a `null` would have been caught by the null-check. A valid-looking
  wrong record defeats both.

  **Breaking — `findOne` now refuses a query that selects nothing in particular.**

  FROM → TO:

  | Was                                                         | Now write                                                           | Meaning                                          |
  | ----------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
  | `findOne(o)`, `findOne(o, {})`, `findOne(o, { where: {} })` | `findOne(o, { where: … })`                                          | the record matching this predicate               |
  |                                                             | `findOne(o, { search: 'Acme' })`                                    | the record this search finds                     |
  |                                                             | `findOne(o, { orderBy: [{ field: 'created_at', order: 'desc' }] })` | the FIRST record in this order — the newest      |
  |                                                             | `find(o, { limit: 1 })`                                             | any row will genuinely do, said at the call site |

  One-line fix: add the `where` you meant, or `orderBy` if you meant "the newest
  one", or switch to `find(o, { limit: 1 })` if any row will do. The error names
  all four. `find` and `count` are unchanged — returning or counting every row is
  an honest answer; only `findOne`'s implicit "just one of them" turns a missing
  predicate into a confidently wrong record. The guard reads the CALLER's
  predicate, before RLS/sharing middleware injects its own: a tenant filter
  narrows which rows are visible, it does not make "whichever comes first"
  something the caller asked for.

  **Two silent drops that produced the same wrong record are fixed with it.**

  - **`findOne({ search })` applies the search.** The ADR-0061 `search` →
    cross-field `$contains` expansion lived inline in `find` and nowhere else,
    while `find` and `findOne` are checked against the SAME legal-key set — so
    `search` passed the gate, rode onto the AST, and reached a driver. No driver
    reads `ast.search`. The read therefore ran with no predicate at all and
    `limit: 1` did the rest. The expansion is now one method both call.
  - **`MongoDBDriver.findOne` applies `orderBy`, `fields` and `offset`.** It
    translated `query.where` and dropped the rest, so `findOne({ orderBy })` did
    not return the newest record — it returned whichever document the scan reached
    first. `find` and `_findStream` in the same driver had always handled all
    three. This one matters beyond Mongo: the guard above tells an unpredicated
    caller to reach for `orderBy`, and an escape hatch one backend ignores is not
    an escape hatch. No ordering is IMPOSED when the caller supplies none — both
    drivers keep that carve-out (#4363), and `SqlDriver`'s comment about Mongo
    "never sorting" is corrected, since it cited the dropped parameter as
    agreement.

  **And a gate so the class does not come back.** A drift pin walks
  `ENGINE_OPTION_KEY_SETS.findOne` and requires each declared key to have an
  observable effect — on the AST the driver receives, on the driver options, or in
  an explicit "not executed, and here is why" entry (only `limit`, which the
  contract's `limit: 1` overrides). `search` sat declared-but-unexecuted through
  two rounds of hardening because nothing asked that question.

  Together with #4346 (`filter` → `where` folds on every entry point) and #4400
  (unknown option keys throw), a read parameter the engine does not execute now
  fails at the call site instead of quietly changing the answer.

- d9971d3: fix(driver-sql): `$field` 跨字段比较改为按 ADR-0112 响亮拒绝,不再抛裸 TypeError

  `{ amount: { $gt: { $field: 'budget' } } }`(spec `FieldReferenceSchema`,由 `compileCelToFilter` 在转译含字段间比较的 CEL 权限/RLS 规则时产出)此前被 SqlDriver 当作**绑定值**交给驱动,sqlite 抛出无 `code`、无 `status` 的裸 `TypeError` —— 落在 `INVALID_FILTER` 信封之外,到客户端表现为不透明的服务端错误。更隐蔽的是列表位置:`$in` / `$between` 里的 `$field` 成员连报错都没有,直接静默返回零行。

  现在两者都以完整信封拒绝(`error.code = INVALID_FILTER`、HTTP 400、无 `[sql-driver]` 前缀),报错点名字段、运算符与被引用字段,并说明跨字段比较**当前仅内存求值路径(`matchesFilter`)支持**。三个比较发射点统一处理,Filter Protocol 与数组三元组两种写法得到同一答案。

  同一处闸门补上了 issue 指出的通用臂:**已知运算符 + 无法绑定的值形态**(标量比较位上的普通对象 / 数组)此前同样是裸 `TypeError`,现在也返回 `INVALID_FILTER`。`$in` / `$nin` / `$between` 的正常数组绑定不受影响。

  `FieldReferenceSchema` 声明保留,JSDoc 补注执行支持面(内存求值 ✅ / SQL 下推 ❌ 响亮拒绝);SQL 列对列编译实现见 #5222。

- 0e3a226: fix(authz): widen the driver's native tenant scope to the membership union
  under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

  The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
  under `group`, but the ObjectQL engine also propagated the active-org
  `tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
  scoping ANDed `organization_id = tenantId` under the union — collapsing every
  group read back to active-org (isolated) reach. Found by the cloud-side
  `ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
  against a real driver.

  - `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
    native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
    keeping the NULL-tenant global-row carve-out; inserts still stamp from
    `tenantId` (the active organization is the write target, D5). Absent or
    empty ⇒ equality fallback — fail toward isolation, never toward exposure.
  - ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
    `tenantIds` when the tenancy posture is `group`, reported by a new
    `setTenancyPostureProvider` seam.
  - SecurityPlugin wires that provider at start — deliberately from the
    enforcement layer, so the driver wall only widens while the Layer 0 union
    wall enforces above it. Embeddings without plugin-security keep active-org
    equality.

- 81ce41a: feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

  Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
  rows are no longer rejected by `initialStates` — but the OTHER half of a historical
  migration, preserving the original timeline, still didn't hold: an imported ticket
  that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
  importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
  fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
  sorting all came out wrong.

  Three layers were force-overwriting the timeline; all three now respect a single
  new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
  alongside `skipStateMachine`:

  - **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
    and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
  - **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
    `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
    symmetric with how `created_at` / `created_by` already behave on insert; and the
    static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
    audit/timestamp family plus author-declared business `readonly` fields — so an
    upsert refresh no longer drops them.
  - **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
    force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
    empty, mirroring the insert stamp).
  - **rest** — the import runner sets `preserveAudit` on the write context iff the
    request opts into `treatAsHistorical`.

  Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
  `system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
  columns) STAY stripped, so a historical import reinstates established facts without
  becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
  unaffected — this changes only which audit/readonly values the runtime overwrites,
  never who may write the record. Fully opt-in: a normal write still auto-stamps
  `updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
  "Import as historical data" checkbox (objectui#2815) now drives both halves — no new
  UI.

- ef678d0: fix(driver-sql): a failed index read is an error, not an empty index list (#7332)

  `SqlDriver.introspectIndexes` wrapped its **entire** dialect dispatch — the
  SQLite, Postgres and MySQL branches alike — in one bare `catch {}` and then
  returned its accumulator in whatever half-built state it had reached. The caller
  could not tell _"this table genuinely has no such index"_ from _"the read failed
  and I am guessing"_.

  Drift detection consumed that same function. `diffManagedIndexes` takes its
  declared-index-missing branch on exactly that input, so a transient failure —
  SQLITE_BUSY, a WAL read landing mid-flush, any I/O hiccup — was not surfaced as
  an error. It was laundered into a confident, specific and **false** report:

  ```
  product: metadata declares index 'idx_product_code' (code) but the database
  has no such index — run "os migrate apply" to create it.
  ```

  …about an index that was there the whole time.

  **The swallow is kept where its justification holds, and only there.** That
  justification — _"let creation handle conflicts"_ — is sound at
  `getExistingIndexNames`, whose caller `syncDeclaredIndexes` corrects an
  optimistic wrong reading by attempting the create and absorbing the
  "already exists" error; a throw there would take a whole boot down on a
  transient read. Detection has no such backstop, and inherited the swallow only
  because #3728 wired a second consumer onto the same function. `introspectIndexes`
  therefore now **throws by default** and takes an explicit
  `{ onFailure: 'partial' }` opt-in, which the creation seam passes and nothing
  else does.

  **What changes for you.** Nothing on the creation path: boot still tolerates a
  failed index read and still converges the schema. On the detection path, a
  failure that was previously invisible is now reported as one — `os migrate plan`
  and `os migrate apply` print it and exit non-zero instead of rendering a plan
  built on a partial reading, and boot-time drift handling logs
  `could not introspect '<table>' for drift detection` (a handler
  `reconcileAndWarnDrift` already carried) instead of a false drift warning. This
  matches the sibling read in the same detect path, `introspectColumns`, which has
  never swallowed.

  Measured, and worth stating plainly: no consumer ever acted **destructively** on
  the false reading. Dropping entries from the physical list is monotone — the
  `replace_unique_index`, `drop_index` and `recreate_index` remedies all require an
  index to be _present_, so a short read can only ever remove a destructive
  proposal, never arm one. The defect was a confidently wrong report, not a
  dangerous one.

- 8825a06: drivers: `limit: 0` returns no records, on every driver and every read door

  `limit: 0` was ruled in #6485 to mean **return no records**. Three of the five shipped
  drivers did not honour it, in three different ways — and the ones that disagreed
  returned **more** data than was requested, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter. Reachable since #6578: the client now puts
  `top=0` on the wire, so the answer depended on which driver a deployment configured.

  **`driver-memory` — the slice was dropped.** `find()` sliced with `if (query.limit)`,
  truthiness, and `0` is falsy. Measured before the fix, three rows seeded:
  `{ limit: 0 }` returned **3 of 3**, and `{ limit: 0, offset: 1 }` returned 2 — the
  OFFSET applied and the LIMIT silently did not, which is why every paging suite stayed
  green over it. Two more sites of the same shape in `memory-analytics.ts` (the `$limit`
  pipeline stage and the SQL string builder) moved with it. Mingo honours `{ $limit: 0 }`
  as zero records (measured), so presence is sufficient there.

  **`driver-mongodb` — the value was forwarded faithfully, to a client that means
  something else by it.** `buildFindOptions` already tested presence, so `0` arrived
  exactly as written — but the MongoDB Node driver DEFINES `limit: 0` as _no limit_, so
  the answer was still the whole collection. Fixed with an explicit short-circuit that
  returns the empty result **before the client is consulted** (`[]` from `find`, `null`
  from `findOne`, which had the same hole). No round trip is made for a query whose
  answer is already known, and no future change in the upstream driver's reading of `0`
  can move this behaviour. Deliberately `=== 0`, not `<= 0`.

  **`driver-sql` — two doors disagreed with a third.** `findRows()`, the door `find()`
  goes through, has always compiled `limit` on presence. Two others compiled it on
  truthiness:

  - `findWithWindowFunctions()` — the live window-function read door (#4286). Returns
    rows, so this was user-visible wrong data: `{ limit: 0 }` returned the whole table.
  - `analyzeQuery()` / `explain()` — returns a plan. It compiled `select * from "orders"`
    where `find()` sent `... order by "id" asc limit ?`, so it explained a statement
    other than the one that would run.

  `offset` moved with `limit` at both doors for internal consistency only. That half is
  **measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
  and MySQL alike. It is pinned as the no-op it is rather than reported as a fix.

  **`driver-turso` remote transport — an `OFFSET` with no `LIMIT` was a syntax error.**
  Surfaced by the new conformance control that reads with a bare offset. SQLite's grammar
  is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses independently,
  so `find(obj, { offset: N })` with no `limit` produced `near "OFFSET": syntax error` —
  for **every** `N`, and only on the remote transport (the local half goes through knex,
  which synthesises the `LIMIT -1` no-limit sentinel). Remote now builds the same
  statement knex does.

  Result sets only ever get **narrower**. A caller who wants every row should omit
  `limit` rather than pass `0`.

  `@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
  case-set pinning this — with controls, so "return nothing, always" cannot pass it. All
  **five** drivers answer it, with **no DEBT rows**: future drift goes red at
  `check:driver-conformance` rather than being discovered in production.

- 6146b67: `os migrate plan` no longer creates a database on a project that has never been started (#6743)

  `migrate plan` is a dry run, and since #3917 it has reported the boot-time
  create-table DDL and the artifact seed instead of performing them. It still
  brought the database file itself into existence, though: SQLite creates the
  file at open, so a `plan` in a fresh project left behind a 0-table
  `.objectstack/data/objectstack.db` — a write side effect from a read-only
  command, and one that erased the only signal ("no database file yet") by which
  the next command can tell a never-started project from a started one.

  A missing SQLite target is now opened as an empty in-memory database instead of
  being created. **The plan output is unchanged**, deliberately: a database with
  zero tables is exactly what a freshly created empty file is, so "every table
  needs creating" — the true and useful answer for a new project — still prints,
  and the `Database:` line still names the real target path rather than the
  in-memory stand-in.

  New driver capability, additive and off by default:
  `SqlDriverConfig.sqliteAbsentFile` (`'create'` | `'empty-in-memory'`, default
  `'create'`). Every existing caller keeps SQLite's own create-if-absent
  behaviour. It is threaded to the driver as a host-composition option
  (`createDefaultDatasourceDriverFactory`, `DefaultDatasourcePlugin`,
  `createStandaloneStack`), not as an authorable `datasource.config` key — a
  datasource must not be able to declare itself into never persisting.

  `os migrate apply` deliberately does **not** use it: it boots deferred too, but
  flushes the deferred DDL after confirmation and needs a real file to flush into.

- 4fccace: docs(driver-sql): `isOrganizationScopedUnique` documents the FIELD-level spelling only

  The exported helper's JSDoc claimed it judged organization scope "on either
  spelling (field-level `unique` or a declared index's `unique`)". It does not,
  and never did: both of its call sites pass `field.unique`, while
  `normalizeDeclaredIndex` scopes a declared index with a strict
  `idx?.unique === 'organization'` — so a declared index's bare `unique: true`
  is taken verbatim as global.

  That divergence is deliberate (the #4986 answer, ADR-0120 D1), but the comment
  invited the tidy-up that would erase it — routing the declared-index branch
  through the helper, which is option 1 of #8323 (⛔ rejected by the maintainer,
  2026-08-13) and pre-empts the bare-spelling question parked on #5082. The
  corrected JSDoc states what the helper actually judges, points at
  `normalizeDeclaredIndex` and #5082, and records why unifying the two paths is
  rejected: it would silently reinterpret every existing declared `unique: true`
  on deployed databases as organization-scoped.

  Documentation only — no behaviour, signature or type change. Shipped as a patch
  because the helper is a top-level export of the package entry point and
  `declaration: true` with no `removeComments` puts this text in the published
  `dist/index.d.ts` a consumer reads.

- a13827e: fix(data): paging a sorted read is a partition of the result set, not five queries that share a WHERE clause (objectui#3106)

  `ORDER BY status LIMIT 50 OFFSET 50` names a sort key that does not identify a
  row, and no backend promises that rows with equal keys keep the same relative
  arrangement between two queries. MongoDB documents this outright — `sort` +
  `skip`/`limit` on a non-unique key "may return the same document more than
  once". So page 2 could repeat a row page 1 already showed and skip one nobody
  ever saw:

  ```
  page 1: ORDER BY status LIMIT 5 OFFSET 0   -> [r05 r07 r11 r04 …]
  page 2: ORDER BY status LIMIT 5 OFFSET 5   -> [r04 …]        r04 again; one row never served
  ```

  Every page is full, every row is real and belongs, and the duplicate sits
  several screens from the omission — which is why this is found by a user
  counting records, never by reading a response.

  `SqlDriver` and `MongoDBDriver` now append a unique tie-breaker to any non-empty
  `orderBy`, in the last requested key's direction (determinism holds either way,
  but a same-direction suffix is the one an index can still walk in one pass).
  `driver-memory` already conformed — `Array#sort` is stable over a table whose
  order does not move — and now has a suite saying so, because that property is
  implicit and easy to lose in a refactor that looks like a speed-up.

  `SqlDriver` adds it only for objects it created itself (`initObjects` records
  those). A federated table (ADR-0015) may have no `id` column, and guessing there
  would be worse than doing nothing: the unknown-column error is answered by
  #3821's ladder retrying with **no ORDER BY at all**, trading a reshuffle among
  ties for the loss of the caller's whole sort.

  The obligation is now normative on `IDataDriver.find`, with shared cases in
  `@objectstack/spec/data` (`PAGINATION_CASES`) that all three drivers run — so a
  future driver is held to it by a gate rather than by remembering.

  Not covered by this change: a paged read with **no** `orderBy`. Same defect,
  wider blast radius, so it was carved out to #4363 rather than folded in — and
  closed there, in the same release. The contract, the shared cases and both
  drivers now cover a paged read whatever its `orderBy`, including none at all.

- 2ddba89: fix(tenancy): eight sites answered "is this deployment multi-org?" with the demoted `OS_MULTI_ORG_ENABLED` (#5262)

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the authoritative knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — therefore reads `false` from
  `resolveMultiOrgEnabled()` while running a fully mounted organization wall.
  #5233 corrected two sites in `plugin-auth`; a census found eight more, all
  written before that function's doc comment was corrected. Third recurrence of
  the shape (cloud#1020, #5233).

  Each site was judged separately for **which** posture answers its question —
  what the operator REQUESTED, or what the `tenancy` service reports is actually
  IN FORCE — rather than converted mechanically:

  - `objectql` `SchemaRegistry` — the env-derived multi-tenant default. Reads the
    REQUESTED posture (it is constructed below the kernel, with no service
    registry to ask). The `organization_id` column was always provisioned; what
    diverged is its INDEX, so a posture-only deployment ran the Layer 0 wall's
    hottest predicate unindexed while SecurityPlugin compiled that same wall.
  - `plugin-dev` — whether to load the enterprise `@objectstack/organizations`.
    REQUESTED posture, mirroring `serve.ts`: this branch is what mounts the wall,
    so asking whether the wall is up would be circular. A posture-only dev stack
    previously never loaded the package at all and served traffic unwalled. Its
    diagnostic now names the posture that was requested instead of asserting
    `OS_MULTI_ORG_ENABLED=true` at an operator who never set it.
  - `runtime` `AppPlugin` (inline seed + hot-reload seeder) — EFFECTIVE posture,
    via the `tenancy` service. These ask "will the per-org replay run instead of
    me?", and on an ADR-0093 D5 degraded boot that replay does not exist, so
    keying on the request would defer to a replay that can never happen. Walled
    deployments previously inline-seeded exactly the NULL-organization rows the
    code's own comment exists to avoid.
  - `cloud-connection` marketplace local install (install-time seed + rehydrate
    heal) — EFFECTIVE posture, same reasoning. The install path is a write path:
    a walled deployment wrote every sample row with no `organization_id`, landing
    the app's data outside the wall its own reads apply.
  - `driver-sql` `isMultiTenantMode()` — REQUESTED posture (a driver has no
    kernel to ask, and a suppressed warning is the costlier error for a
    diagnostic). It also no longer memoises into `_multiTenantMode`: that froze a
    process-level fact into a per-instance verdict on whichever write landed
    first. The gate now resolves live, which is affordable because
    `auditMissingTenant` consults it only after the `tenantId` early-out.
  - `cli` `os verify` — REQUESTED posture. This one produced a green verification
    run over an unverified property: a posture-only deployment silently skipped
    every multi-tenant proof and exited 0.

  **No configuration change is needed anywhere.** Deployments setting only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  belt-and-braces configuration stays valid. Deployments that set only
  `OS_TENANCY_POSTURE` can now drop the redundant boolean. Single-org behaviour is
  unchanged at every site; only the knob each one reads is corrected.

- 3fe0ff1: fix(driver-sql): `os migrate plan` no longer promises columns the apply can never create (#3978)

  `previewDeferredSchemaWork()` listed every declared field name when computing
  pending `create_table` / `add_columns` work, but `createColumn` returns early
  for a virtual `formula` field — no column is ever created for it.

  So a formula field showed up as pending `add_columns` that `apply` reported as
  performed without doing anything, and the very next `plan` reported it again.
  A freshly-applied database looked permanently un-migrated, with no invocation
  able to clear the finding. On `examples/app-crm` that was 4 columns
  (`crm_contact.full_name`, `crm_lead.is_closed`, `crm_opportunity.expected_revenue`,
  `crm_opportunity.days_to_close`) reported forever.

  The preview now filters through `fieldHasColumn` — the same helper `createColumn`
  and the column differ already answer "does this field materialize a column?"
  with — so the plan and the flush cannot disagree. `multiple` fields are
  unaffected: they materialize as a JSON column and are still reported.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                                                                                                                                                   |
  | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`                                                                                                                             |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                                                                                                                                                   |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | the same `expand`, keeping the FK in your own projection (`fields: ['title', 'owner_id']`) — **not** a dotted `fields` path, which no driver resolves and the ingress refuses (#7532) |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias`                                                                                                                      |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- 76bcb83: feat(spec): filter-subtree provenance — the cross-field refusal names an author's own columns again, without re-disclosing policy (#8220, A of the #7929 ruling)

  #8198 (B of the 2026-08-12 #7929 ruling) made the SQL family's cross-field
  `{ $field }` refusal withhold its operands from **every** caller, because the
  predicate reached the driver as a bare `FilterCondition`: an administrator's
  CEL sharing/permission rule and the author's own filter were indistinguishable
  there. The accepted, named cost was the author's diagnostic. This change is A
  — the sanctioned follow-up that pays it back behind a real mark instead of a
  guess.

  **The mark** (`@objectstack/spec/data`, `filter-subtree-provenance.ts`) is a
  spec-declared symbol on a filter subtree: `markFilterSubtreeProvenance(subtree,
'author' | 'policy')`, read positionally by
  `resolveFilterSubtreeProvenance(root, node)` (innermost mark on the ancestor
  chain wins; located by object identity, never structural equality). It rides
  the `where` tree by reference across the `DriverQuery` boundary — no new slot,
  documented on `DriverQuery` itself — and is dropped by exactly the operations
  (serialize, copy, rewrite) after which no attestation could be trusted.

  **Set at both read-scope merge boundaries**: `plugin-security`'s CRUD RLS
  injection marks every injected scope `'policy'` and the caller's verbatim
  predicate `'author'` — the latter only under the identity vouch
  `ast.where === options.where`, so a tree a sibling middleware already rewrote
  is vouched for nobody. `service-analytics`' `ObjectQLStrategy.withReadScope`
  marks its scope `'policy'` and the strategy-built user filter `'author'` (and
  `resolveFkAttr`'s scope arm `'policy'`).

  **Consumed by the SQL family** (`driver-sql`, `driver-turso`'s
  `RemoteTransport`; `driver-sqlite-wasm` inherits): a refusal raised from a
  subtree positively marked `'author'` carries its full diagnostic on the wire
  again — both columns, the operator, the list index, the boundary reason —
  same identity (`INVALID_FILTER` / 400).

  **⚠️ The fail direction is closed, and it is the design**: unmarked or
  ambiguous — no mark anywhere, a mark lost to serialization, a node
  unreachable from the query's own `where`, conflicting aliased marks —
  withholds exactly like `'policy'`. The mark is permission to reveal, never a
  requirement to prove secrecy; a driver-side guess at provenance is the shape
  the #7929 triage rejected.

  **Two B-era pins were REWRITTEN deliberately, not weakened.** First,
  `service-analytics`' `cross-field-engine-fallback.test.ts` pinned B's blanket
  redaction on refusals of the caller's OWN `where` (no scope in play) — under A
  that caller is the vouched author, so those cases now assert the corpus's
  `diagnosticIncludes` fragments are back on the wire, while the
  policy-injected-scope case gains the explicit non-disclosure assertions as its
  fail-closed pair. Second, the sharper one:
  `packages/runtime/src/cross-field-refusal-operand-withhold.test.ts` pinned
  author-written and policy-injected refusals **byte-identical** — the strongest
  available statement of "the driver cannot tell them apart", and explicitly the
  assertion A was chartered to supersede. Its successor pins the three-way split
  #8220's "Done means" names: policy-injected withholds (unchanged), the vouched
  author's filter names its columns again (the messages now differ, by design),
  and an unmarked predicate still withholds **byte-identical to the policy
  case** — B's surviving half. Reading that diff as a regression is exactly what
  the old pin's comment warned against; the file header carries the full
  account.

  Unaffected: the REST boundary's 5xx-only withhold (#5367/#5667) and every
  refusal outside the cross-field family.

- 9c5abf4: fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

  Two shapes the Filter Protocol never declared were reaching the drivers, and
  every driver ANSWERED them — with a different answer. Both are now refused with
  `INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
  already speaks.

  ## `$null` with a non-boolean comparand — a behaviour change you can observe

  `FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
  default branches hung on opposite sides, so one filter meant opposite things per
  backend. Measured against one row with `stage: 'won'` (id 1) and one with
  `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

  | backend                                     | read as                           | rows        |
  | ------------------------------------------- | --------------------------------- | ----------- |
  | driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`)    | `["2"]`     |
  | driver-memory query path, driver-mongodb    | IS NOT NULL (anything but `true`) | `["1"]`     |
  | driver-memory reference matcher             | no constraint at all              | `["1","2"]` |

  **What changes for you:** a caller that today gets rows back for
  `{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
  operator, the field and the position. That includes calls working by truthy /
  falsy coincidence — and the sharpest case is the STRING `"false"`, which is
  truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
  the opposite of what its author wrote it to mean, on at least one of them
  whichever they meant. A JSON round-trip or generated metadata produces it
  readily.

  **The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
  `{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
  backends, and so is every other operator. `$exists` is deliberately NOT tightened
  here — it diverges on its own axis (what "exists" means for a null-valued key)
  and is tracked separately.

  ## An undeclared `$op` in a document position — silent empty set becomes a 400

  `FilterConditionSchema` declares exactly three `$`-keys at a node
  (`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
  compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
  `{ $expr: … }` produced a predicate that matched nothing and reported nothing —
  a caller could not tell "no rows matched" from "the filter never compiled". The
  FIELD position had refused the same class of input since v16, so one driver gave
  two answers depending on depth.

  **What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
  returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
  (and `driver-sqlite-wasm`, which inherits it) into line. The three declared
  combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
  and every legal filter compile byte-identically.

  Both refusals are raised on the driver's validating walk rather than in its SQL
  emitter, so a malformed node is refused regardless of whether a sibling
  disjunct would have short-circuited the compile.

- f98fa65: fix(driver-sql): a fresh database no longer boots "drifted", and the drift
  detector never points `--allow-destructive` at an index the framework created
  (#4884)

  Booting `examples/app-showcase` on a brand-new empty SQLite file printed two
  `[schema-drift]` warnings before the server was even ready, both about the
  ADR-0048 overlay indexes the same boot had just created. Both were false, and
  one of them was dangerous:

  > `[schema-drift] sys_metadata: index 'idx_sys_metadata_overlay_draft' UNIQUE
(type, name, organization_id) carries ObjectStack's generated naming but
matches no declared index (orphaned) — "os migrate apply --allow-destructive"
to drop it.`

  `idx_sys_metadata_overlay_draft` is the unique index enforcing **draft-overlay
  uniqueness**. An operator following our own boot advice would have dropped a
  live data-integrity guarantee to fix a problem that did not exist — and, worse,
  learned to treat `--allow-destructive` as routine boot hygiene, which is exactly
  what makes the _next_, real drift warning dangerous.

  Three fixes, in the driver's detector only (no metadata declaration changed —
  `sys-metadata.object.ts` documents its four-column `indexes[]` entry as _the
  fallback shape for drivers without the runtime migration_, and that contract
  still holds for the drivers that rely on it):

  - **The index key is now read as written.** Introspection took the key from each
    dialect's per-column catalogue view (`PRAGMA index_info`, `pg_attribute`,
    `STATISTICS.COLUMN_NAME`), which describes an expression key as a NULL column
    and nothing else. The canonical
    `(type, name, organization_id, COALESCE(package_id,''))` overlay index
    therefore arrived as three columns and was reported as a mismatch against its
    own four-column declaration. SQLite and Postgres now parse the index
    definition (`sqlite_master.sql` / `pg_get_indexdef`), MySQL reads
    `STATISTICS.EXPRESSION` where the server has it, and `COALESCE(col, <literal>)`
    is recognised as keying on `col` — which is what ADR-0048 uses it for: a plain
    UNIQUE index treats NULLs as distinct, so package-less globals would not be
    unique among themselves.
  - **Partial predicates are captured.** A `WHERE`-restricted index is something
    `syncDeclaredIndexes` can neither create nor rebuild, so the detector no
    longer claims authorship of one, no longer calls it orphaned, and never
    proposes a remedy it could not undo.
  - **The driver keeps a ledger of the index DDL it executed.** An index this
    process created through raw `execute()` — how `metadata-protocol`'s
    `ensureOverlayIndex` issues its migration — is the framework's to manage. This
    also covers the plain-index fallback the same migration takes on dialects that
    reject partial indexes.

  Genuine drift is unaffected: an orphaned generated index, a redefined declared
  index and the #3696 legacy-unique replacement are all still detected, still
  categorised exactly as before, and still remediable through `os migrate`.

- 3510e4a: refactor(spec,drivers,lint): one implementation of the filter identity reduction (#5659)

  `{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
  disjunct that absorbs its `$or`, `{ $not: {} }` is FALSE. That is a ruling
  (#5322/#5134) pinned for every backend by the four identity cases in
  `FILTER_LOGIC_CASES` — and it was implemented four times over: `reduceFilterNode`
  in `driver-sql`, the same function again in `driver-mongodb`, the
  `every`/`some`/truthiness algebra of `driver-memory`'s matcher, and nearly a
  fifth hand-written copy inside `@objectstack/lint`, which declined to write one
  and filed this issue instead.

  **New in `@objectstack/spec` (`@objectstack/spec/data`): `reduceFilterVerdict`**,
  beside the case table that proves it. It answers `'true' | 'false' | 'clause'`
  for a filter node and never throws on its own; each backend's own refusals — the
  undeclared `$`-combinator and the `undefined` comparand in `driver-sql`, the
  query-level keys and the `$null` comparand in `driver-mongodb` — are passed in as
  `FilterVerdictHooks` and are invoked from exactly the positions they were invoked
  from before. `reduceFilterKeyVerdict` answers the same question for one key, which
  is what both SQL and MongoDB emitters consult while walking a node.

  **No behaviour changes in the three drivers.** The move is mechanical: the shared
  algebra replaces each private copy, the refusals stay where they were, and the
  `FILTER_LOGIC_CASES` conformance suites are green on both sides of the change —
  including the SQL-inheriting `driver-sqlite-wasm` and `driver-turso`.

  **`@objectstack/lint` gains two warnings it was structurally blind to.** The
  `multi: true` unbounded-bulk-write rule (#5482) asked "does this filter have zero
  keys", so a `delete_record` bounded by `filter: { $and: [] }` or
  `filter: { $or: [{}] }` — a whole-object write by the ruling every driver executes
  — passed silently. It now asks the reduction, and it warns about both while
  staying quiet on `{ $or: [] }` and `{ $not: {} }`, which match nothing. The
  message names the shape it saw (`a filter that REDUCES TO TRUE ({"$and":[]})`)
  rather than calling a non-empty filter "empty".

  If you have a flow declaring a bulk write bounded by one of those two shapes, the
  lint will now tell you so — the write was already unbounded at run time; only the
  feedback is new.

- 647ec8b: fix(driver-sql,sharing): an unsortable query loses its ORDER BY, not its rows (#3821)

  `SqlDriver.find()` already recovered from a SELECT projection naming a column
  the table lacks (retry with `select('*')`, the unknown field is simply absent
  from each row). The identical failure one clause over — an **ORDER BY** column
  the table lacks — fell through to `return []`. Because `count()` is a separate
  statement, the list endpoint answered `HTTP 200` with `records: []` and
  `total: 3`: the rows are there, none are shown, nothing is logged. Same family
  as the `$`-param footgun closed by #2926.

  It surfaced through the Console's sharing-rule **recipient picker**, which
  never listed a single candidate. The client mangled `'name asc'` into
  `0 n,1 a,2 m,…` (fixed separately in objectui) and the driver turned that into
  "no users exist", so no sharing rule could be authored from the UI at all.

  Rows now outrank their order: the retry ladder drops the projection first (the
  likelier culprit and the cheaper thing to lose), then the sort, then gives up.
  A query that cannot be sorted comes back **unordered instead of empty**. Errors
  that are not about an unknown column still propagate untouched.

  **A rule authored in Setup now actually applies — and switching it off actually
  withdraws access.** Writing a `sys_sharing_rule` rebound the per-record hooks,
  which only makes the rule reach records written FROM THEN ON. So an admin who
  created a rule and enabled it saw nothing happen: the recipient's list stayed
  empty until somebody happened to touch each record. The reverse was worse —
  switching a rule OFF, or deleting it, left every grant it had already issued in
  place, and boot backfill only reconciles ACTIVE rules, so those grants outlived
  restarts while the UI displayed the rule as disabled. The reconcile was reachable
  only through `POST /sharing/rules/:id/evaluate`, which the Console never calls.

  Each non-system write to `sys_sharing_rule` now also reconciles that rule's
  grants, chained behind the existing rebind: insert/update run the same
  diff-based `evaluateRule` the REST endpoint runs (it purges when the rule is
  inactive), and delete purges directly via the new
  `SharingRuleService.revokeRuleGrants` — `evaluateRule` can't help there because
  the row is already gone (`RULE_NOT_FOUND`), which is also why a rule deleted
  through the plain data API used to orphan its grants. Seeding and package
  bootstrap write with `isSystem` and are skipped; `kernel:bootstrapped` already
  backfills those. Reconciliation is best-effort and never fails the write.

  **The dialog's help text was engineering notes, shown to tenant admins.** The
  field descriptions on `sys_sharing_rule` render under each input in Setup, and
  they cited ADR numbers, table and column names (`parent_business_unit_id`,
  `sys_business_unit`), enum machine values the dropdown never shows
  (`business_unit`, `team`), a third-party library (better-auth), and engine
  vocabulary ("evaluation", "lifecycle"). Several were also stale: they still told
  admins to type an id or hand-write a `FilterCondition` after those inputs became
  a record picker and a visual builder. Rewritten for the reader who actually sees
  them — the implementation detail was already in the object's doc comment, which
  is where it stays. `criteria_json`'s LABEL loses its "(FilterCondition JSON)"
  suffix for the same reason, and `active` can finally say what it now does:
  turning it off withdraws the access.

  Also refreshes the `sys_sharing_rule` help text in the zh-CN / ja-JP / es-ES
  translation bundles, which still described `recipient_type` in terms of
  `department` (the enum value is `business_unit`) and told admins to enter a
  queue name for `recipient_id` (`queue` was removed in ADR-0078). The es-ES
  option labels for `position` / `unit_and_subordinates` were translated as
  "rol" — corrected to "Puesto" / "Unidad de negocio y subordinados".

- 193cd5c: fix(driver-sql): 空 `$and`/`$or`/`$not` 按布尔单位元编译 —— `$or: []` 不再返回全表

  **这是一处查询行为变更,且直接关系到 RLS。** `{ $or: [] }` 以前返回**整张表**,
  现在返回**零行**。如果你的代码依赖了旧行为,它依赖的是一个 filter 旁路。

  `applyFilterCondition` 把每个组合子都编译成一个 knex 分组回调,而 knex 对「一个子句
  都没加进去的分组」不产出任何 SQL。于是「这个组是空的」和「这个组已被满足」编译成了
  同一条查询。**丢弃子句不等于套用单位元**,而两个单位元的方向是相反的:

  | 写法                 | 布尔代数                      | 旧编译    | 错的方向     |
  | -------------------- | ----------------------------- | --------- | ------------ |
  | `{ $and: [] }`       | TRUE → 全部行                 | 全表      | 碰巧正确     |
  | `{ $or: [] }`        | FALSE → **零行**              | 全表      | **静默放松** |
  | `{ $or: [{a}, {}] }` | `{}` 是 TRUE 析取项 → 全部行  | `(a = ?)` | 静默收紧     |
  | `{ $not: {} }`       | `NOT TRUE ≡ FALSE` → **零行** | 全表      | **静默放松** |

  `$and: []` 恰好正确的理由不是代码理解了单位元,而是「丢掉」在 AND 侧碰巧等价于
  TRUE —— 同一段代码在 OR 与 NOT 侧就必然错。放松的那两格是安全相关的:`$or: []`
  最常见的来源正是「本该有条件、但循环一个析取项都没填进去」的 RLS read scope,
  把它当成全表意味着**本该看不到任何行的人拿到了整表**。

  同仓另外两个后端(`formula` 的 `matchesFilterCondition`、`driver-memory`)三条
  本来就都是对的,`driver-sql` 是唯一的例外;现在四个答案统一。

  **配套的形状拒收(否则修复会变得更糟)。** 套用单位元的前提是「编译成空」只剩一个
  成因。在此之前 `$or: [null]`、`$or: ['x']`、`$or: [[…]]`、`$or: [new Date()]`
  同样会无痕消失;不先拦掉它们就上单位元,会把它们从「被静默忽略」**升级成「匹配所有
  行」**,比原 bug 更坏。因此 `$and`/`$or` 的元素与 `$not` 的操作数现在必须是
  **plain object** 的 filter 节点,否则按 ADR-0112 响亮拒收
  (`INVALID_FILTER` / 400,报错指明出错位置,如 `filter.$or[1]`)。原型检查是关键
  的一半:`Date`/`RegExp`/class 实例都满足 `typeof x === 'object'` 却枚举为空,
  若被接受就会被读成 TRUE。同理 `$and: 'x'` 这类非数组操作数也不再被当成一个名为
  `$and` 的字段列。

  判定是**结构性**的(编译前先归约整棵树),而不是「编译完再问 knex 有没有产出」——
  原缺陷本身就是后者那种观察,而观察分不清「因为本来就是空」和「因为有东西没编译
  出来」。结构判定没有这个盲区,并且保证编译器打开的每个分组都至少收到一条子句,
  knex 再没有机会静默丢弃一个组。

  非空的 `$and`/`$or`/`$not` 编译方式完全未变。

- 5aae790: fix(driver-sql): `$not` 改为 NULL-safe —— 被比较列为 NULL 的行不再被否定条件静默排除

  **这是一处可观察的查询行为变更,且直接关系到 RLS 的可见集合。**
  `{ $not: { stage: 'won' } }` 以前**不返回** `stage IS NULL` 的行,现在**返回**它们。
  如果你的规则依赖了旧行为,它依赖的是「同一条规则在不同后端给出不同可见集合」。

  SQL 是三值逻辑:`NULL = 'won'` 是 UNKNOWN,`NOT UNKNOWN` 仍是 UNKNOWN,而 `WHERE`
  只保留 TRUE。于是 `applyFilterCondition` 编译出的裸 `NOT (stage = 'won')` 会把
  「该列没有值」的行整批丢掉;同一条 filter 在 `driver-memory` 与 `formula` 的
  `matchesFilterCondition` 上是普通的两值 JS 求值(`undefined !== 'won'` → 行匹配),
  两边把这些行**都返回**。一个 spec 声明的算子,答案取决于跑它的是哪个驱动。

  这不是「数目对不上」而已:权限规则里的 CEL `!expr` 经 `cel-to-filter.ts` 正是降解成
  `{ $not: {…} }`,所以同一条 read scope 在 SQL 数据源与内存数据源上准入的行集不同。
  #5146 判定以 JS 家族的答案为准(2:1 的多数派;写 `!(stage == 'won')` 的人不会预期
  「stage 为空的行被隐藏」),本次把 SQL 侧对齐过去。

  **编译出来的形状。** `$not` 的操作数在取反之前先被改写成**全域(total)谓词** ——
  永远是 TRUE 或 FALSE,不会是 UNKNOWN:

  ```sql
  -- 之前
  not (`stage` = 'won')
  -- 现在
  not ((`stage` is not null) and (`stage` = 'won'))
  ```

  对 issue 里给出的扁平形状,这与 `NOT (…) OR col IS NULL` 完全等价。把守卫下推到
  **每个叶子**而不是挂在 `NOT` 旁边,是为了在操作数嵌套时仍然正确:`$not` 里套一个
  `$or` 时,顶层的 `OR col IS NULL` 会把 JS 家族排除的行重新放进来(某一列为 NULL、
  但另一个析取分支成立的行)。

  **守卫方向按算子逐个判定,不是一刀切。** `{ $not: { a: { $ne: 5 } } }` 的语义是
  「a 就是 5」,两个 JS 后端都把 NULL 行排除在外;无条件加 `OR a IS NULL` 会把这些行
  交回去 —— 正是本驱动反复付过学费的静默放松(#2704 / #5134)。因此
  `$ne` / `$nin` / `$notContains` 用的是 `col IS NULL OR (…)`,`$eq` / `$in` /
  `$gt` / `$contains` 一族用 `col IS NOT NULL AND (…)`,而 `$null` / `$exists` /
  `$eq: null` / `$ne: null` 本来就是全域谓词,一个字节都不加。

  **只有 `$not` 路径被改写。** 普通比较的 SQL 逐字符不变(`{ a: 1 }` 仍然是
  `a = 1`),因此没有任何非否定谓词因此失去索引;`$not` 路径上的 `IS NOT NULL` 守卫
  本身处在一个原本就不可 sargable 的 `NOT (…)` 里。

  `#5134` / PR #5243 定下的布尔单位元(`{ $not: {} }` → 零行、`$not` of FALSE →
  全部行、非 filter 节点的操作数按 ADR-0112 响亮拒收)全部保持不变;`{ field: {} }`
  (#5240)也刻意不在此裁定 —— 它编译出的 SQL 与之前完全一致。

  `driver-memory` 与 `formula` 无需改动,本次为三家各补了一组 pin 测试,把「值缺失
  行在 `$not` 下的去留」钉在一起。跨驱动 conformance case(`FILTER_LOGIC_CASES`)与
  契约 TSDoc 归 spec 车道,随 #5239 落地。

- 07f1822: fix(driver-sql): `$ne` / `$nin` / `$notContains` 改为 NULL-safe;`$exists` 的非布尔比较值改为拒收

  **这是一处可观察的查询行为变更,且直接关系到 RLS 的可见集合。**
  `{ stage: { $ne: 'won' } }` 以前**不返回** `stage IS NULL` 的行,现在**返回**它们。
  `$nin` 与 `$notContains` 同理。

  ### 变更一:三个否定算子在 `$not` 之外也 NULL-safe(#5298)

  #5146 已经把 `$not` 判定为 NULL-safe(PR #5296),但**只改了 `$not` 内部**;算子自身
  携带否定的三个 —— `$ne` / `$nin` / `$notContains` —— 逐字符未变。于是留下一个使用者
  可见的裂缝:`{ $not: { stage: 'won' } }` 三家一致,`{ stage: { $ne: 'won' } }` 仍然
  分叉。

  成因与 #5146 同源:SQL 是三值逻辑,`NULL <> 'won'` 是 UNKNOWN 而不是 TRUE,`WHERE`
  只保留 TRUE;`driver-memory` 与 `formula` 的 `matchesFilterCondition` 用两值 JS 求值
  (`undefined !== 'won'` 直接为真),把这些行**都返回**。2026-08-06 裁定取「包含无值行」
  方向(与 #5146 同向),本次把 SQL 侧对齐过去。

  ```sql
  -- 之前
  `stage` <> 'won'
  `stage` not in ('won')
  `stage` NOT LIKE '%won%' ESCAPE '\'
  -- 现在
  (`stage` is null or `stage` <> 'won')
  (`stage` is null or `stage` not in ('won'))
  (`stage` is null or `stage` NOT LIKE '%won%' ESCAPE '\')
  ```

  **统一用 OR 展开,不走方言等价物**(`IS DISTINCT FROM` / `IS NOT` / `<=>`),三条理由:
  `NOT LIKE` 根本没有对应形式,走方言就必然要维护两种形状;SQLite 的写法依赖本仓并不
  锁定的引擎版本(sql.js 与 libSQL 各自演进);实测 `EXPLAIN QUERY PLAN` 两种写法计划
  完全相同 —— `<>` / `NOT IN` / `NOT LIKE` 改动前**本来就是全表扫描**,没有索引可失去,
  也没有索引可赢回。

  **正向比较一个字节都没动。** `{ a: 1 }` 仍然是 `a = 1`,`$in` 仍然是 `in (…)`,
  `$gt` / `$contains` 一族同理,所以绝大多数普通查询的 SQL 形状不变。
  `$ne: null` 也不变 —— 它是空值**谓词**(`IS NOT NULL`)而不是比较,「有任何值」对
  一个没有值的行本来就是假。

  **`$not` 路径不受影响。** `nullSafeNegationOperand` 的逐叶守卫按原样保留:它必须能在
  操作数任意嵌套时通过 De Morgan 组合,这与叶子发射器自身是否全域是两个独立的正确性
  来源,把它们耦合起来会让其中一个的回退静默破坏另一个。

  ### 变更二:`$exists` 的非布尔比较值改为拒收(#5369,套用 #5347 裁定 A)

  `FieldOperatorsSchema` 声明 `$exists: z.boolean()`,而从 `where` 到驱动之间没有任何
  环节按它校验,所以非布尔值真的会到达发射器。到达之后各后端分叉方向相反:本驱动的
  `opValue === false` 恒等判断把「除 false 以外的一切」读成 `IS NOT NULL`,`=== true`
  的写法则把「除 true 以外的一切」读成 `IS NULL`。注意字符串 `"false"` 是**真值**,
  所以它落在与作者本意**相反**的一侧 —— JSON 往返或 AI 生成的 scope 很容易产出它。

  现在与 `$null` 的闸门并排,在 `reduceFilterKey` 的校验遍历里拒收,`INVALID_FILTER` /
  400,信封与措辞同款。`{ $exists: true }` / `{ $exists: false }` 行为一字未变。

  **发射器与极性表刻意不动。** 闸门落地后只有两个布尔值能到达它们,`opValue === false`
  与 `value === false` 已经是穷尽的二选一。#5369 正文建议的「收紧为 `value === true`」
  方向写反了:极性表回答的是「NULL 列是否**满足**该算子」,而 NULL 列恰恰在调用方要求
  `$exists: false` 时满足它 —— `$null: true` 与 `$exists: false` 是同一个问题,两条
  分支正确地互为镜像,而不是互为副本。

  ### 相关

  `driver-memory` / `driver-mongodb` 的对应半边按 #5499 冻结,本次零改动、既有一致性
  断言全绿;`driver-turso` 的 remote transport 是独立编译器,归 #5903;
  `service-analytics` 的 `filter-normalizer`(Cube 面)归本裁决第二批。

- 5f0852f: fix(driver-sql): bucket a SQLite `Field.datetime` by its stored instant instead of collapsing every row into one `(null)` (#3773)

  On SQLite, any trend chart bucketed by day/week/month/year over a
  `Field.datetime` column put **every record in a single `(null)` bucket** — one
  bar, carrying the whole total. The measure was right; only the bucket key was
  wrong. `Field.date` (ISO TEXT storage) was unaffected, so the same dashboard
  could show one column working and the next one flat.

  better-sqlite3 stores a `Field.datetime` as INTEGER epoch **milliseconds** (knex
  binds a JS `Date` as `.getTime()`), and `buildDateBucketExpr` emitted a flat
  `strftime('%Y-%m', col)`. SQLite reads a bare integer as a **Julian day
  number**; an epoch-ms value is far outside the legal range, so `strftime`
  returned NULL for every row. Nothing downstream noticed: SQLite advertises
  `queryDateGranularity.month`, so `engine.aggregate` pushes the bucketing down,
  and its in-memory fallback only engages for an _unsupported_ granularity or a
  non-UTC timezone.

  The SQLite expression is now storage-aware, sharing one `isEpochStoredDatetime`
  predicate with the filter-comparand coercion added for the same root cause in
  \#2034 — a window and a bucket that disagree about storage is exactly how an
  epoch column ended up correctly filtered and then entirely bucketed as NULL.
  Postgres and MySQL are untouched: `defineColumn` maps `Field.datetime` to a
  native timestamp there, which is also why their comparands are left alone.

  Two details are load-bearing and pinned by tests:

  - The conversion dispatches on each **stored value's** type, not just the
    declared one. A SQLite `Field.datetime` column is genuinely mixed-form —
    `formatInput` passes datetime values through, so a `Date` lands as INTEGER
    while an ISO string (including an unresolved `defaultValue: 'NOW()'`) lands as
    TEXT. Dividing TEXT by 1000 coerces it to its leading year, filing live rows
    under 1970 — worse than the NULL it replaced.
  - Division is `/1000.0`, not `/1000`. Integer division truncates toward zero, so
    a pre-1970 instant (`-1` ms) would surface as 1970-01-01.

  `bucketDateValue` (the in-memory fallback in `@objectstack/objectql`) now reads a
  finite **number** as epoch milliseconds. `new Date(String(1767225600000))` is an
  Invalid Date, so a driver handing back raw storage values bucketed as `'(null)'`
  there while the pushed-down SQL bucketed correctly — fixing only the driver would
  have traded one wrong answer for two different ones, and the two paths have to
  label the same instant identically for a drill-down to survive crossing them.

  `SqliteWasmDriver` inherits `buildDateBucketExpr`, so it carried the bug and gets
  the fix.

- bee5ffe: drivers: every SQL read door routes through the tenant chokepoint (#6792)

  `SqlDriver.applyTenantScope()` owns read-side tenant isolation for the whole SQL family —
  the `tenantId` early-out, the "object has no tenant field" early-out, the NULL-org
  platform-row rule (#2734) and the ADR-0105 D2 union posture (#3623). Its own docstring
  said "every CRUD method routes through it". Nothing ever checked that, and it was false
  for as long as it had existed. **Three** read doors built their query through
  `getBuilder()` and never arrived:

  - **`findWithWindowFunctions()`** — the documented #4286 window door. It returns **rows**,
    so on a deployment where the scope would have applied (`options.tenantId` set, object
    has a tenant field) it returned rows belonging to **every** tenant. Measured with two
    tenants seeded plus one NULL-org platform row: `tenantId: 'org_a'` returned
    `[a1, a2, b1, b2, p1]` here against `find()`'s `[a1, a2, p1]` — another tenant's rows,
    handed over at the driver layer.
  - **`analyzeQuery()` / `explain()`** — returns a **plan**, not rows, so this is a smaller
    fix and it is made on its own merits rather than folded into the one above. It is the
    same defect #6577 fixed on these two methods one builder line lower: a plan is only
    worth reading if it explains the statement `find()` would actually run, and a missing
    tenant predicate changes selectivity and therefore which index the planner picks.
    Compiled `select * from account` where `find()` sent the `organization_id` clause.
  - **`distinct()`** — returns one column's **values** for every tenant. This one was in no
    card. #6792 states the opposite, listing `distinct` among the scoped call sites; the
    13th read site is `aggregate()`. It was found by measuring the invariant rather than
    re-reading it.

  All three now call `applyTenantScope()` beside their `getBuilder()` line, the position
  `findRows()` uses. They route through the chokepoint rather than re-deriving a predicate:
  a local equality would silently drop NULL-org platform rows (#2734) and collapse group
  reads to active-org reach (#3623). Both of the chokepoint's early-outs are inherited
  unchanged, so an unscoped admin/seed read (no `tenantId`) and any object without a tenant
  field behave exactly as before.

  **The durable half is a gate, not the three lines.** `pnpm check:tenant-chokepoint`
  (`scripts/check-tenant-chokepoint.mjs`, wired into `.github/workflows/lint.yml`) re-derives
  the invariant from the AST across the `SqlDriver` family on every run: a method that builds
  through `getBuilder(object, options)` must call `applyTenantScope()` on that builder, or
  carry a written exemption. Insert builders are exempt structurally — write-side tenancy is
  `injectTenantOnInsert` — rather than by a name list. It is keyed on the **builder** and not
  on the method signature, because the signature criterion the card sketches ("takes
  `(object, …, options)` and returns rows") misses `distinct` (no `query` parameter) and
  `analyzeQuery` (returns a plan). Verified red against the pre-fix tree, red against a
  newly-added unscoped door, and silent once that door is scoped.

  The chokepoint docstring no longer asserts the invariant; it names the gate that proves it.

  If you call these doors directly on a multi-tenant deployment, pass `options.tenantId` as
  you would to `find()` — that is what now takes effect. Callers that never passed it are
  unaffected; that remains the documented unscoped/admin path.

- d71ff32: fix(platform-objects,plugin-security,driver-sql): `sys_user_preference` and `sys_capability` uniqueness is per organization (#8323)

  Both objects declared their uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object it
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) Measured on a deployment running
  `OS_TENANCY_POSTURE=isolated`:

  - **A user in two organizations could never persist a preference key they had
    already used in the first one.** `sys_user_preference`'s `(user_id, key)` was
    installation-wide, so the second organization's write was refused by a row the
    caller cannot read — and `data-objectstack`'s `userState.save()` swallows the
    failure by design, so "recent items" and similar preferences silently stopped
    persisting in a user's second workspace, with no error anywhere.
  - **`sys_capability.name` refusals were an existence oracle across tenants.** An
    organization could POST a name and read `409` vs `201` to learn whether some
    other organization — or the platform seed — already held it, while its own
    `GET` on that name returned zero rows.

  Both declarations now say `unique: 'organization'` (ADR-0120 D1), materializing
  `(COALESCE(organization_id,'__global__'), …)`. Platform-seeded rows carry no
  organization and the key part is NULL-safe (ADR-0120 D3), so they stay unique
  among themselves and `bootstrapSystemCapabilities`' upsert-by-name is unaffected.
  Same-organization duplicates are still refused — the constraint is scoped, not
  removed.

  The bare `unique: true` spelling itself is **unchanged**; whether it should be
  reinterpreted is #5082 (v18), and the publish-time authoring advisory is #8379.

  **Migration (`@objectstack/driver-sql`).** Respelling a declared index changes
  its generated name, which on a deployed database read as two unrelated findings:
  the composite missing (`create_index`, safe) and the old global index orphaned
  (`drop_index`, **destructive**). An operator applying only the safe half would
  have kept the global index — i.e. kept the defect — while the plan read as
  applied. The declared-index respelling now routes through the same
  `replace_unique_index` retirement the field-level `unique` migration has used
  since #3728: one finding, categorised `safe`, CREATE before DROP, and the legacy
  index dropped only once the replacement is confirmed present. Any two rows
  colliding on `(organization, …fields)` already collided on `(…fields)`, so the
  replacement can neither fail on existing data nor lose any.

  Operators upgrading a deployed database should run `os migrate plan` / `os
migrate apply` — no `--allow-destructive` is required. Until the retirement is
  applied the old index keeps enforcing, so the constraint is never unenforced at
  any point in the migration.

- 939f579: drivers(sql,turso): 聚合函数拒收带上 ADR-0112 信封,并把两类条件分开措辞

  `SqlDriver.mapAggregateFunc()` 与 `RemoteTransport.aggregate()` 此前对同一条件各抛一个裸
  `Error`(`code`/`status` 皆 `undefined`),`mapDataError` 因此落默认分支——一条本该 4xx 的
  调用方错误以不透明 500 到达客户端。两处同时改,同一信封体例、首句逐字一致(#5240):

  - **协议未声明的函数名**(如 `median`)→ `INVALID_QUERY` / 400。这正是协议门
    (`metadata-protocol` 的 `invalidQueryError`,#4254)对同一条件已经给出的码,于是
    进程内调用方与 REST 调用方读到同一个答案。
  - **协议已声明、本后端编不出**(`count_distinct` / `array_agg` / `string_agg`)→
    `NOT_IMPLEMENTED` / 501。这是能力缺口而不是调用方的错(`driver-mongodb` 编得出这三个),
    措辞明确说明查询拼写无误,不把作者说成打错字。

  两面都只改拒收的身份:编得出的五个函数生成的 SQL 逐字节不变。

- 694c350: fix(drivers): a `conflictKeys` upsert with no backing unique index refuses legibly on **Postgres** too, not only SQLite (#8567)

  `SqlDriver.upsert` recognised "the `ON CONFLICT` target is not backed by a
  PRIMARY KEY or UNIQUE index" on **SQLite only** (#8445). `driver-sql` serves
  three dialects, so on Postgres the raw driver error still escaped: `mapDataError`
  fell through to its default branch and served the thrown message as the whole
  response body — and that message is the **statement**, with no `code` for any
  client to branch on.

  **What a Postgres caller got, and now gets.** Measured against a real
  PostgreSQL 16.13 through the same knex + `pg` path the driver uses:

  ```
  before:  code=42P10  status=undefined
           message=insert into "plain" ("email", "id", "title") values ($1, $2, $3)
                   on conflict ("email") do update set "title" = excluded."title"
                   - there is no unique or exclusion constraint matching the ON CONFLICT specification

  after:   code=VALIDATION_ERROR  status=400
           message=Cannot upsert into "plain" on conflict keys ("email"): no PRIMARY KEY or
                   UNIQUE index backs them, … Fix by declaring the column(s) "unique: true" …
  ```

  The accept/reject set does not move: the same upserts fail, they fail legibly.
  The server's own sentence is preserved on the error's `cause`, which no error
  mapper puts on the wire, so an operator debugging the table keeps the ground
  truth while the caller stops receiving SQL text.

  **One clause of the refusal wording changed, on both faces.** "…and SQLite
  refuses the statement" is now "…and **the database** refuses the statement".
  Once recognition covers Postgres, naming SQLite points a Postgres operator at
  the wrong engine. `driver-turso`'s remote-face copy moved in the same commit —
  the two are held word-for-word identical (#5240) by #8568's cross-face parity
  pin. No other sentence of the refusal changed.

  **Recognition is now a named, shared predicate.**
  `isUnbackedConflictTargetError` is exported from `@objectstack/types` beside
  `isUniqueViolationError`, carrying one measured message limb per dialect that
  can raise the condition. ⚠️ It is deliberately a **separate** predicate:
  `isUniqueViolationError` answers the opposite condition (an index exists and the
  row violated it), and a merged one would report a working constraint as a
  missing one.

  **MySQL is unaffected, by measurement rather than omission.** knex compiles
  `onConflict(...).merge(...)` on that dialect to `ON DUPLICATE KEY UPDATE`, which
  takes no conflict target — the named keys never leave the process, so the server
  is never asked to find an index for them and the condition cannot arise. The
  compiled statement is pinned; the live MySQL cell is reported as un-run rather
  than passing vacuously.

- acf34e3: fix(drivers): refuse an `undefined` filter comparand instead of crashing (SQL) or silently answering `IS NULL` (Turso remote) (#6050)

  **⚠️ 行为变更(升级说明在最后一节)。** 比较数位置上的 `undefined` 从「静默/崩溃」变为 `INVALID_FILTER` / 400 拒收。作者侧的修法是显式判空,或改用 `null` / `$null`。

  ## 实测到的毛病

  同一个 `TursoDriver`,同一条过滤器,答案取决于它是用哪个 `url` 构造的 —— 四行 fixture(`d` 在 1-2 有值、3-4 为 NULL),`origin/main` @ `cba7454df`:

  | filter                                | LOCAL(继承 `SqlDriver`)          | REMOTE(`RemoteTransport`) |
  | ------------------------------------- | -------------------------------- | ------------------------- |
  | `{ d: undefined }`                    | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ d: { $eq: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ $not: { d: undefined } }`          | 抛裸 knex `Undefined binding(s)` | `['1','2']`               |
  | `{ d: { $ne: undefined } }`           | `['1','2']`                      | `['1','2']`               |
  | `{ $not: { d: { $ne: undefined } } }` | `[]`                             | `['3','4']`               |
  | `{ d: { $in: [undefined] } }`         | 抛裸 knex `Undefined binding(s)` | `[]`                      |
  | `{ d: { $gt: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `[]`                      |

  两个可分开的毛病:

  **A —— 抛出的那几格没有 ADR-0112 信封。** knex 的 `Undefined binding(s) detected when compiling SELECT` 既没有 `code` 也没有 `status`,`mapDataError` 落默认分支,于是一条「调用方把 filter 写坏了」的错误以不透明 500 的形态到达客户端。#1116 / #4436 为这条通路清点过同类形态,唯独漏了这一格。

  **B —— 守卫与它自己的发射器分裂。** `$ne` 发射器读 `coerced == null`(宽松,所以 `undefined` 编译成 `IS NOT NULL` —— 一条 TOTAL 谓词),而必须钉住这个发射器的两张极性表 `operatorIsNullTotal` / `nullValueSatisfiesOperator` 读 `=== null`(严格,于是判它「不 total」且「NULL 行满足它」)。`nullGuardForFieldSpec` 因此把一条已经 total 的谓词包成 `d IS NULL OR d IS NOT NULL` —— 恒真 —— 取反后恒假,答 `[]`。这正是 #5298 立的不变量(每张极性表钉的是它自己发射器的拼写)在它自己的定义处被破坏。

  ## 修法

  一道闸,落在比较数进入**任何**发射器或守卫之前,两个毛病同闸消灭:knex 再也见不到 undefined 绑定,守卫与发射器对 undefined 的分歧变成**不可达**而不是「被修好」。

  - `driver-sql`:闸落在 `reduceFilterKey` 的校验走查上(与 `$null` / `$exists` 的拒收并排),外加 `applyFilters` 的平铺映射分支 —— `{ d: undefined }` 进不了走查(`typeof undefined` 不是 `'object'`,构不成 `hasMongoOperators`),而它恰恰是这个 bug 最常见的拼写。两处共用一个函数。
  - `driver-turso`:`buildWhereSQL` 入口做一次整棵子树的前置走查。必须前置,否则 `{ $not: { d: undefined } }` 会先把操作数交给 `nullSafeNegationOperand`(一个守卫)。
  - 顺带把两侧的 `== null` / `|| === undefined` 拼写统一收严成 `=== null`(#5347 收紧 `$null` 臂时给的理由:宽松拼写在闸被挪走后会悄悄恢复回答一个没人裁决过的取值)。

  拒收的位置逐个清点:直接比较数、单值算子的比较数(`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族)、列表算子数组的**成员**(`$in`/`$nin`/`$between`)、以及嵌在 `$and`/`$or`/`$not` 里的以上各位。`$null` / `$exists` 的 `undefined` 保持它们**自己**的拒收措辞(比较数是声明的布尔量,那条消息更贴切 —— #5240「一个条件一种措辞」两个方向都适用)。两个驱动的拒收句子逐字一致。

  ## ⛔ `null` 一字未动

  `{ f: null }`、`{ $eq: null }` → `IS NULL`;`{ $ne: null }` → `IS NOT NULL`;`$null: true/false` 不变;`null` 仍是合法的 `$in` 成员。`null` 是声明过的比较数,拒的只是 JS 里与「没有这个键」不可区分的那个值。

  ## 升级说明

  如果你的进程内代码这样拼过 filter:

  ```ts
  // 之前:id 缺失时 —— 本地崩、远端静默匹配全环境行
  await ql.find("deal", { where: { owner_id: ctx.user?.id } });
  ```

  现在会收到 `INVALID_FILTER` / 400,消息里带修法。两种正确写法:

  ```ts
  // 1) 显式判空 —— 键不存在就是「不约束」
  const where: Record<string, unknown> = {};
  if (ctx.user?.id !== undefined) where.owner_id = ctx.user.id;

  // 2) 真的想要空值谓词 —— 写出来
  await ql.find("deal", { where: { owner_id: null } }); // 或
  await ql.find("deal", { where: { owner_id: { $null: true } } });
  ```

  `where` 整体缺席仍然是「没有过滤器」(`query?.where` 为 `undefined` 是它唯一合法的位置),不受影响。

  ⚠️ 本次只覆盖 `driver-sql` 与 `driver-turso`(含 remote)。`driver-memory` / `driver-mongodb` 是 #5499 的投入冻结面,按裁决只测不改;`@objectstack/formula` 与 `service-analytics` 的 `read-scope-sql.ts` 对同一形状各有一种不同读法,实测记录在 #6125,留待单独裁决。

- 8b50cb3: fix(data): a paged read with no `orderBy` is a partition too — the shape every list view actually sends (#4363)

  objectui#3106's server half closed the **sorted** paged read: a non-empty
  `orderBy` now carries a unique tie-breaker, so `ORDER BY status LIMIT 50 OFFSET
50` can no longer serve one row twice while never serving another. It stopped
  there deliberately. This closes the half it left, which is the more common one.

  A list view whose metadata configures no `sort`, on which nobody has clicked a
  column header, sends no `$orderby` at all. `SqlDriver` and `MongoDBDriver` then
  emitted a bare `LIMIT`/`OFFSET` — and neither backend promises anything about
  the order that slices:

  - **SQL** leaves the row order of an unordered read to the plan. Small tables
    hand back insertion order in practice, which is exactly why this survives
    testing; a parallel scan, an index scan, or a `VACUUM` need not.
  - **MongoDB** returns natural order, which describes where a document currently
    sits in its extent — and moves when the document does.

  Every row ties with every other on an empty sort key, so this is the same defect
  at full strength rather than a different one: page 2 repeats a row page 1 showed
  and drops one nobody sees, with every page full and every row real.

  Both drivers now order a paged read by their unique key column when the caller
  supplied no sort keys — the same `id` the tie-breaker was already appending, now
  standing alone. `driver-memory` again needed no change: it slices its backing
  array, and two reads with no write between them see the identical sequence. The
  contract asks for a partition, not for id order.

  **Unpaged reads are untouched, deliberately.** The rule keys off `limit`/
  `offset`, not off `orderBy` being absent. A read with neither hands back the
  whole matching set, so no caller can be shown a partial view of it, and sorting
  every read in the system would change plan selection to buy nothing. `limit`
  alone does count as paged: page one of a walk is routinely `limit=50` with no
  offset, and ordering only the later pages would leave the defect fully intact.

  `SqlDriver` keeps the existing restriction to objects it created itself
  (`initObjects` records them). It matters more here than for the sorted case: on
  a federated table (ADR-0015) there is no requested sort for #3821's ladder to
  fall back to, so a wrong guess about `id` would turn a reshuffle into a failed
  read. Those tables now get a warning — once per object, behavior unchanged —
  because the contract states determinism as a MUST, and a MUST that quietly does
  not hold is the same invisible failure the rule was written against.

  `findOne` is deliberately outside all of this, and the contract now says so.
  Engines reach a driver with `limit: 1`, which is shaped exactly like page one of
  a walk, but it promises _a_ matching record rather than a position in a
  sequence — nothing for a second call to be inconsistent with. Reading it as a
  page would put `ORDER BY id LIMIT 1` on the hottest read in the system, which is
  the classic shape for a planner to abandon the predicate's own index: measured
  on Postgres 16 over 2M rows, `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms
  and swapped the `owner_id` index for the primary key. `MongoDBDriver.findOne`
  has never sorted, so this also puts the two drivers back in step.

  The obligation is normative on `IDataDriver.find` and the cases are shared —
  `PAGINATION_UNORDERED_CASES` alongside `PAGINATION_CASES` in
  `@objectstack/spec/data` — so a future driver is held to both halves by a gate
  rather than by remembering.

- 2342ee4: fix(driver-sql): an `upsert` whose `conflictKeys` have no backing unique index refuses with an ADR-0112 envelope instead of a raw `SqliteError` (#8445)

  `SqlDriver.upsert` let SQLite's error escape exactly as raised when the named
  conflict keys were not backed by a PRIMARY KEY or UNIQUE index. Measured on the
  local face (knex + better-sqlite3):

  ```
  upsert('plain', { email: 'a@b.com', title: 'x' }, ['email'])
    -> THREW name=SqliteError code=SQLITE_ERROR status=undefined
       msg=insert into `plain` (...) values ('a@b.com', ...) on conflict (`email`)
           do update set ... - ON CONFLICT clause does not match any PRIMARY KEY
           or UNIQUE constraint
  ```

  **The payload was the larger half of the defect.** `mapDataError` builds the
  response envelope from `error.code` / `error.status`; with neither set it falls
  through to its default branch and serves the thrown message as the entire body —
  and that message is the **statement**, bound values inlined. So a caller got no
  `code` to branch on _and_ the SQL text of the write it attempted.

  The condition is now recognised at the throw site and re-raised as
  `VALIDATION_ERROR` / 400, carrying the original error as `cause` so the SQLite
  text an operator debugging the table needs is preserved rather than destroyed.
  The wording is `driver-turso`'s remote refusal (#8413), first sentence for first
  sentence — `TursoDriver` picks its face from `url`, so one condition answered in
  two wordings would make the answer a property of the connection string (#5240).

  **No call that worked before fails now, and no call that failed before
  succeeds.** The same upserts are refused; they are refused legibly. A
  `conflictKeys` upsert whose target _is_ backed by a declared `unique: true`
  still merges, and the default `id` merge key is untouched — both pinned as
  controls beside the refusal, because an implementation that refused every
  `conflictKeys` upsert would satisfy the refusal assertion while having broken
  the capability.

  **Recognition is SQLite-first, by decision rather than by oversight.** SQLite
  fills exactly one channel for this condition — the message; it raises a plain
  `SQLITE_ERROR`, the same generic code a syntax error carries, so `code` cannot
  discriminate. Postgres and MySQL wording for the same condition is unmeasured
  (no server for either was available to raise it), so those dialects keep the
  behaviour they have today rather than being matched on transcribed-from-memory
  text. Measuring them, and deciding whether the recognition then belongs in a
  shared predicate in `@objectstack/types` beside `isUniqueViolationError`, is
  tracked on #8567.

- 0166bd5: fix(spec,drivers): the view filter vocabulary and the AST vocabulary now agree (#3948)

  `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) is what an author may declare on a
  `ViewFilterRule`. `VALID_AST_OPERATORS` (`data/filter.zod.ts`) gates
  `isFilterAST()`, which decides whether a filter is parsed into a query at all.
  They disagreed on **8 of 19** members: `equals`, `not_equals`, `greater_than`,
  `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `before`, `after`.

  An author could declare any of them, `ViewFilterRuleSchema` validated them,
  `defineStack` accepted them — and then `isFilterAST()` refused the filter, the
  protocol passed the array through unconverted, and the driver could not apply it.
  Six of the eight were reachable only in theory because ObjectUI's adapter alias
  table happened to translate them; the safety of the query path was resting on a
  hand-written table in another repository being complete, and for `before`/`after`
  it wasn't.

  **`AST_OPERATOR_MAP` is now the single source of truth.** `VALID_AST_OPERATORS`
  is derived from its keys rather than restated, so an operator can no longer be
  accepted by the gate without also having a lowering — the two were separate
  hand-written lists that happened to agree, with nothing enforcing it. The map
  gained the eight canonical view spellings plus the squashed/short forms stored
  metadata carries (`notequals`, `greaterthanorequal`, `eq`, `gt`, …).

  **New export `canonicalAstOperator(op)`** folds every accepted spelling of one
  comparison onto a single infix form. Both drivers now call it instead of growing
  private alias lists, which is what let them accept different vocabularies.
  `like`/`ilike` are deliberately not folded onto `contains`: driver-sql passes them
  to SQL verbatim, so folding would silently wrap the value in `%…%`.

  Widening only — no spelling was removed, so no stored filter stops validating.
  A filter that previously produced an error (after #4029) or was silently dropped
  (before it) now compiles. `filter-view-operator-parity.test.ts` asserts every
  `VIEW_FILTER_OPERATORS` member and every `VIEW_FILTER_OPERATOR_ALIASES` key has a
  lowering that is a real `$`-operator rather than the `$${op}` fallback, so the
  next operator the view layer gains fails a test instead of a query.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/observability@17.0.0

## 17.0.0-rc.6

### Major Changes

- 29e28a3: refactor(drivers)!: `aggregate` 的 query 参数收窄到 `DriverQuery`，并退役 `aggregate` / `func` 两个未声明别名 (#6212 批 B、#6321)

  #5181（PR #6076）收窄了 `IDataDriver` 声明的六个方法，#6075（PR #6210）让五个驱动的实现跟上，#6212 批 A+E 处理了 SQL 驱动自有的另两道门。本次是同一条线上的 `aggregate`：`driver-sql`、`driver-turso` 的转发层与 `RemoteTransport` 三处，全部从 `query: any` 收到 `DriverQuery`（`@objectstack/spec/contracts`）。

  `any` 在 query 参数上不是「对象名没检查」，而是**检查全关**：`where` 的 filter 方言、`groupBy` 的节点联合、`aggregations` 的节点形状——而这三样恰恰是这几个方法体读的全部内容。

  ## 一、退役两个协议从未声明的别名（#6321，ADR-0049）

  ```ts
  const aggregates = query.aggregations || query.aggregate; // driver-sql
  const funcName = agg.function || agg.func;
  const aggregations = query?.aggregations || query?.aggregate || []; // RemoteTransport
  const func = String(agg.function || agg.func || "");
  ```

  `QueryASTSchema` 声明的是 `aggregations`，`AggregationNodeSchema` 声明的是 `function`；`aggregate` / `func` 在 `packages/spec` 里**一个字都没有**。实测全仓唯一书写者是这两个驱动包自己的 fixture（`sql-driver-advanced` 7 处、`sql-driver-queryast` 1 处、`sqlite-wasm-driver-advanced` 7 处、`sqlite-wasm-driver-queryast` 1 处），非测试面零书写者——#4984 那一家：**fixture 拼着别名，宽容分支就永远绿着活下去，没有任何测试能在删掉它时转红**。fixture 已按已声明拼写重拼，写者归零，PD#12 与 ADR-0049 enforce-or-remove 于是把这两条 `||` 一并删掉。

  顺带删掉的还有 `|| ''`：它只在**两个键都没写**时才生效，而那时这一面把名字回引成 `""`、本地面回引成 `"undefined"`，同一份越界输入两种措辞（#5240）。别名在时这条岔路够不着，删别名恰恰让它够得着，所以同一次关掉。

  **迁移**：`aggregate:` → `aggregations:`，`func:` → `function:`。写旧拼写的内联字面量现在是编译错误（TS2353）；越过 `tsc` 的 JS 调用方，`aggregate:` 会静默拿不到聚合列，`func:` 则拿到已有的具名 400（`INVALID_QUERY`，#5907）。本仓实测需要改动的非测试调用点为零。

  ## 二、一处真实行为改动：`RemoteTransport` 现在会编 `GroupByNode` 联合

  `GroupByNodeSchema` 是 `z.union([z.string(), z.object({ field, dateGranularity?, alias? })])`，而这一层把它当 `string[]` 读。收窄后 `tsc` 直接把这条假设摆上台面（TS2322）。联合的两半状况完全不同，所以这不是一个 cast 能了事的：

  - **无 granularity 的结构化条目**（`{ field: 'region' }`）是 spec 合法、且**今天就会下推到驱动**的形状：objectql 的 aggregate 派发对它一律判为「受支持」（`engine.ts` 里逐字写着 `plain {field} object is fine`），`objectql/src/secret-fields.test.ts:341` 就是这个形状的活体。本驱动的**本地面**把它编成普通的 `GROUP BY "region"`，远端面却把它插值成 `"[object Object]"`、死在标识符安全检查里——一条查询两种答案、由连接串决定，正是 #6203 那个形状，而且**是活体不是休眠**：能力位 `queryDateGranularity` 只管带 granularity 的那一半，管不到这一半。现在读 `.field`，两面收敛。
  - **带 dateGranularity 的条目**远端确实编不出来，而这一点是**已声明**的：remote 模式发布 `queryDateGranularity: {}`，引擎据此全部落到内存分桶，因此不会下推。缺的是「绕过能力位、直连驱动」的那个调用方该得到什么答案——现在得到 ADR-0112 信封（`NOT_IMPLEMENTED` / 501），与聚合函数「协议已声明、本后端编不出」用的是同一类，而不是一句 SQL 注入告警。

  `alias` **不读**，与本地面一致：`SqlDriver.aggregate` 也不读它，只在这一面读会是新的分叉而不是修复。

  ## 三、`SqlDriver` 那一面的同一条件也换上了信封

  `SqlDriver.aggregate` 对「本方言编不出这个 granularity」原本抛裸 `Error`（`code`/`status` 皆 `undefined` ⇒ `mapDataError` 落默认分支，一个具名能力缺口以不透明 500 到达调用方）。只给远端面加信封就会造出 #5907 花一整个 issue 才关掉的那种分叉——`TursoDriver` 由 `url` 选面，同一条件不能有两种线上身份。两面首句逐字一致（`Date bucketing by '<g>' is not supported by this backend.`），尾句各报**本面**编得出的 granularity，由一条跨包 parity 用例比对两个**运行时**消息钉住。

  **消息文本变更**（可能影响按文本匹配的下游断言）：

  ```
  - SqlDriver: dateGranularity 'week' not supported on dialect 'better-sqlite3'. Engine must fall back to in-memory bucketing.
  + Date bucketing by 'week' is not supported by this backend. Bucketed here: day, month, quarter, year (dialect 'better-sqlite3'). … (code=NOT_IMPLEMENTED, status=501)
  ```

  ## 定级依据

  标 major 与 #5181 / #6075 / #6210 一致：**源码级破坏性**（调用点内联字面量、以及被删的两个别名键），加上第二、三节两处真实的运行期改动。`check:api-surface` 只记录导出的存在与否、不记录签名，所以这条说明是该变更唯一的下游载体。

  `driver-sqlite-wasm` 未列入：它整个继承 `SqlDriver.aggregate`，自身源码零改动（改的只有它的 fixture 与一条断言）——与批 A+E 的处理一致。它读的是 driver-sql 的 `dist/*.d.ts`，因此验证时**必须先重建 driver-sql** 再 typecheck/test，否则是假绿。

  <!-- adr-0087: registered driver-aggregate-undeclared-key-aliases-removed -->

- d367f03: refactor(drivers)!: 五个驱动的 query 参数跟进 `DriverQuery`，休眠的类型谎言就此没有藏身处 (#6075)

  #5181（PR #6076）把 `IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的 query 参数收窄为 `DriverQuery`（`Omit<QueryAST, 'object'>`），并在同一条 changeset 里写明：「把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾」。这就是那次收尾。

  在此之前，五个驱动的实现仍旧声明 `query: QueryAST`（turso 侧是 `query: any`）。**它不红，也不会红** —— 方法参数按双变比较，实现声明得比契约宽照样满足契约。但调用方现在**有权**省略 `object`，于是这些实现的类型说 `query.object` 是 `string`，运行期却可能是 `undefined`：一句休眠的谎言，没有任何门拦得住下一个照着它写代码的人。

  收尾之后，「驱动读 `query.object`」直接变成编译错误：

  ```ts
  // 收窄前：编译通过，运行期可能是 undefined —— 谎言
  // 收窄后：error TS2339: Property 'object' does not exist on type 'DriverQuery'.
  const name = query.object;
  ```

  **零运行时改动。** 本次改的全部是类型注解：五个驱动的六个契约方法签名，以及为让类型自洽而必须跟进的少量私有辅助方法参数（mongodb 的 `buildFindOptions` / `buildSortSpec`，sql 的 `findRows` / `orderKeysFor`，turso 的 `toRemoteQuery` / `toRemoteReadQuery`，memory 的 `performAggregation`）—— 它们都只转发或读取 `where` / `orderBy` / `groupBy` 这些字段，本来就不读 `object`。turso 的几处 `query: any` 一并收紧，多拿回一批本已放弃的检查。emit 无差异，测试全绿（memory 524、mongodb 206、sql 906、sqlite-wasm 254、turso 788）。

  **迁移面：删掉驱动调用字面量里的 `object:` 键**，与 #5181 是同一句话，只是现在也覆盖了直接按具体驱动类（`SqlDriver` / `MemoryDriver` / …）而非按 `IDataDriver` 取类型的调用方。编译器会逐处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。本仓下游 25 个包实测零处需要改动，改动只落在五个驱动自己的测试里。

  标 major 的依据与 #5181 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

  `aggregate` / `distinct` / `syncSchemasBatch` 不在本次范围内 —— 它们不是 `IDataDriver` 收窄的那六个方法，其中 `syncSchemasBatch` 的条目里 `object` 是被真实读取的必填键，`expand` 条目里的 `object` 同理命名的是关联对象，都不是冗余。

- 62159bd: refactor(driver-sql)!: `SqlDriver.distinct` 的第三参收成裸 `FilterCondition`，一个静默返回全集的写法就此编译不过 (#6320)

  `distinct` 不在 `IDataDriver` 上，所以 #5181（PR #6076）与 #6075（PR #6210）的收窄都没走到它，#6212 批 A+E（#6355）收的是 `analyzeQuery` / `findWithWindowFunctions`，也没覆盖它。它的方法体一直说得很清楚——`applyFilters(builder, filters)` 拿的是**实参本身**，因此它要的是 `find()` 放在 `query.where` 里的那个值，**不是 query 信封**；`filters?: any` 只是没把这句话写进类型里。

  ```ts
  // 收窄前后都成立，一处调用点都不用改
  await driver.distinct("orders", "product", { status: "completed" });
  ```

  **收窄真正买到的东西，是实测出来的，不是推断的。** 三行数据（`Laptop`/`Mouse` 为 `completed`，`Ghost` 为 `pending`），逐个形状喂给 `distinct('orders','product', …)`：

  | 第三参                       | 收窄前                             | 收窄后       |
  | :--------------------------- | :--------------------------------- | :----------- |
  | `{ status: 'completed' }`    | 返回 `["Laptop","Mouse"]`          | 不变         |
  | 省略                         | 返回全集                           | 不变         |
  | `'completed'`（标量）        | **编译通过，返回全集**             | **编译错误** |
  | `{ object, where }`（信封）  | 抛 `INVALID_FILTER` / 400          | 不变         |
  | `['status','=','completed']` | 抛 `INVALID_FILTER` / 400（#5158） | 不变         |

  第三行就是本次消掉的那一格：一个真心想问「completed 订单里有哪些商品」的调用，编译通过，然后拿到**每一个**商品。`applyFilters` 对「真值但非对象、非数组」的 filter 不发射任何谓词（该方法尾注写着这件事），于是过滤条件被整条丢掉。方向是**放宽**——这正是 #6320 与 #5234 同族的那类「静默错答案」。

  **有一格是任何类型都关不上的，本次如实写进注释而不是假装关上了。** `FilterCondition` 的键**就是字段名**，所以它是开放映射（`[key: string]: any`）：`{ object, where }` 在结构上是一个完全合法的 filter——约束两个分别叫 `object` 和 `where` 的列。没有任何注解能把它和正当 filter 分开。#6320 提出的「让反向错配也编译不过」在这个参数上**不可达**，实测确认；能拿到的保证是**运行期响亮失败**：信封里的 `where` 是对象，而没有任何比较值可以是对象，于是 `assertCompilableComparand` 抛 `INVALID_FILTER` / 400。这半边 driver-sql 从来就不是静默的；`driver-memory` 那半边（裸 filter 交给它会静默返回全集）留在 #5499 冻结面内，本次不碰。

  **零运行时改动**：非测试改动 100% 是一个类型注解加一段注释，无逻辑、无行为、无 emit 差异。

  **逐处复核了全部 14 个调用点**（本单正文记的是 3 处，实测偏低）：driver-sql 11 处、driver-sqlite-wasm 3 处、driver-turso 0 处；其中真正传第三参的是 4 处（driver-sql 2 + driver-sqlite-wasm 2），全部本来就写的裸 filter，**零报错、零 fixture 改动**。

  **driver-sqlite-wasm 也标 major**：`SqliteWasmDriver extends SqlDriver` 且不覆写 `distinct`，所以它**已发布的 `.d.ts`** 里这个方法的签名同样收窄，它的使用者看到的是同一个变化。该包读的是 driver-sql 构建后的 `dist/*.d.ts` 而非源码，是一处已知门禁盲区，本次用「往参数类型里临时塞一个调用方不可能满足的成员、重建、看调用点是否逐一变红」证明它确实读到了新 d.ts：driver-sql 6 处红、driver-sqlite-wasm 3 处红，与预判逐一相符。

  ### 迁移

  调用点若把**标量**（或任何非 `FilterCondition` 值）交给第三参，编译器会指出来：

  ```
  error TS2345: Argument of type 'string' is not assignable to parameter of type 'FilterCondition'.
  ```

  改法是把它写成它本来就该是的裸 filter 对象（`'completed'` → `{ status: 'completed' }`）。⚠️ 这类调用点在收窄前拿到的是**未过滤的全集**，所以这不是一次等价改写：修完之后返回值会变，而变化后的那个才是调用方本来想要的答案。本仓零处这样的调用点。

  ⚠️ 无类型的 JS 调用方**既不会拿到编译错误、也不会有任何行为变化**（本次零运行时改动）。对他们而言，上面那条是「你一直没在过滤」的**唯一通知渠道** —— 这也是本次记台账条目的理由，见下。

  <!-- adr-0087: registered driver-sql-distinct-bare-filter-typed -->

- d48aad5: refactor(driver-sql)!: `analyzeQuery` / `findWithWindowFunctions` 不再吃 `any`，窗口门自带扁平形类型 (#6212 批 A+E)

  #5181（PR #6076）收窄了 `IDataDriver` 声明的六个方法，#6075（PR #6210）让五个驱动的实现跟上。收尾漏下的是**驱动自有、不在 `IDataDriver` 上**的那批查询门：它们同样吃 query AST，签名却是 `any`。本次处理 SQL 驱动的两个。

  `any` 在 query 参数上不是「对象名没检查」，而是**检查全关**：`where` 的 filter 方言、`orderBy` 的 sort node 形状、`limit`/`offset` 是不是数字，全部被抹掉——而这两个方法体读的恰恰就是这些字段。`$like` 当年就是从同一个口子活到运行时的（cloud#1030、cloud#1053 实测 20 处）。

  **`analyzeQuery` → `DriverQuery`。** 它是 `explain()` 的实现体，而 `explain()` 本来就声明 `DriverQuery` 并一行转发过来——收窄前这一对是自相矛盾的：契约门声明 AST，它背后的实现声明 `any`。方法体只读 `fields` / `where` / `orderBy` / `limit` / `offset`，全在 `DriverQuery` 内，因此这是一次纯注解：driver-sql 与 driver-sqlite-wasm 实测零报错、零 fixture 改动。

  **`findWithWindowFunctions` → 驱动本地的扁平形类型**，新导出 `SqlWindowFunctionQuery` / `SqlWindowFunctionSpec`：

  ```ts
  import type { SqlWindowFunctionQuery } from "@objectstack/driver-sql";

  const ranked = await sqlDriver.findWithWindowFunctions("employee", {
    windowFunctions: [
      {
        function: "rank",
        alias: "salary_rank",
        partitionBy: ["department"],
        orderBy: [{ field: "salary", order: "desc" }],
      },
    ],
  });
  ```

  它**不能**标 `DriverQuery`：`query.windowFunctions` 在 spec 是 `retiredKey()` 墓碑（#4286），`QueryAST['windowFunctions']` 解析为 `undefined`，标上去会让这道门自己已发布文档里的载荷编译不过。类型因此写成 `Omit<DriverQuery, 'windowFunctions'> & { windowFunctions?: SqlWindowFunctionSpec[] }`——契约那一半照旧受检，驱动私有那一半由驱动自己声明。

  类型放在驱动层、**不进 `packages/spec`**，是接着 #4286 的判断往下走：那次删掉 `WindowFunctionNodeSchema` 的理由正是它声明了 `field` / `over` / `frame` 这些门从不读的成员；再往 spec 加一套窗口词汇就是反悔那个判断。spec 的删除注记与 `migrations/registry.ts` 的迁移处方里逐字写着的 `{ function, alias, partitionBy?, orderBy? }`，就是这个类型的出处，三处必须始终说同一句话。请求面的墓碑**没有**被重新打开：`analyzeQuery('o', { windowFunctions: [...] })` 依然是编译错误。

  **顺带（#6212 批 F）**：`@objectstack/verify` 的 `BucketableDriver.aggregate` 从 `query: unknown` 收到 `DriverQuery`。这是一个**已发布**的结构替身，cloud 的 driver-turso 照着它实现——声明 `unknown` 不叫「最小」，叫没检查，并且放任该文件里两处 AST 字面量各自把对象名多写一遍（#5181 的那种冗余）。同时删掉一处 `as never`：那个 cast 只是因为字面量推断把 `'count'` 放宽成了 `string`，注上类型就不需要它了。这里**不预断**驱动自身 `aggregate` 参数类型的收窄（#6212 批 B，排在 #6203 之后）——方法参数按双变比较，驱动那边声明 `any`、`QueryAST` 还是收窄后的类型，都照样满足这个替身。

  **零运行时改动**，全部是类型注解与两处冗余键的删除（实测全仓驱动无一读 `query.object`）。测试：driver-sql 935、driver-sqlite-wasm 254、driver-turso 804、verify 17、dogfood 520 全绿。

  **迁移面**：直接调用这两道门的嵌入方，把内联字面量里编译器指出来的键改对即可（TS2353）。本仓实测非测试生产者为零，两道门只有各自驱动包的测试在用，零处需要改动。标 major 的依据与 #5181 / #6075 一致：**源码级破坏性**（调用点内联字面量与 `BucketableDriver` 的导出形状），运行时行为零变化；`check:api-surface` 只记录导出的存在与否、不记录签名，所以这条说明是该变更唯一的下游载体。

### Minor Changes

- 92a67f2: feat(drivers,spec)!: `GroupByNode.alias` is honoured by the SQL faces — one aggregate, one column key (#6401)

  `GroupByNodeSchema` has declared `alias` ("Alias for the projected group
  value", defaulting to `field`) for as long as the structured `groupBy` entry has
  existed. Exactly one execution path read it. The result: the SAME query came
  back with a different result-column key depending on which path the engine
  happened to take.

  ```ts
  groupBy: [{ field: "closed_at", dateGranularity: "month", alias: "qtr" }];
  ```

  - pushed down to a driver ⇒ rows keyed **`closed_at`**
  - run through the in-memory fallback ⇒ rows keyed **`qtr`**

  And the choice between them is `engine.ts`'s
  `allStructuredSupported && !tzRequiresInMemory` — a driver capability bit and a
  `timezone`, neither of which the caller can see. That is the multi-face
  consistency invariant broken in its quietest form: both answers are valid rows,
  so nothing throws and nothing looks wrong.

  **Resolved to ENFORCE**, and the leg was chosen by measurement rather than
  taste. ADR-0049 splits on whether the feature already exists: a _dangling_
  promise is removed, a _live_ one with a missing gate is enforced. `alias` is
  live — three consumers read it and change behaviour
  (`in-memory-aggregation.ts`, `MemoryDriver.performAggregation`, and
  `chartAggregateCategoryKey`), and the publish gate _compels_ it:
  `validate-react-page-props.ts` errors `REACT_CHART_AXIS_UNKNOWN` unless a
  chart's category axis is bound to `alias ?? field`, telling the author in so
  many words to "bind it to" the alias. A key the build gate makes you write is
  not a dangling promise. The count of real non-test producers is **zero**, which
  is what makes enforcing safe rather than what argues against it: no shipped
  payload changes its result keys.

  **What changed, on every SQL face at once** — a fix landing on one and not its
  twin is the #6203 shape, and `TursoDriver` picks its face from `url`:

  - **`driver-sql`** — both limbs of the structured `groupBy` branch project
    `alias ?? field`: the date-bucket limb aliases the bucket expression to it,
    and the plain limb emits `?? as ??` (only when the name actually moves — an
    alias equal to the field emits no self-rename). `presentedOutput` is now keyed
    by the OUTPUT column, matching how the aggregation branch beside it has always
    worked; an aliased group value went unpresented before.
  - **`driver-turso` REMOTE** — the same projection, `"field" AS "alias"`. The
    alias reaches the statement as a quoted identifier and is therefore held to
    `assertSafeIdentifier`, exactly like `field`.
  - **`driver-sqlite-wasm`** — inherits `SqlDriver`'s compiler; covered by its own
    conformance suite rather than by assumption.

  **GROUP BY still keys on the FIELD** on every face. Only the projection is
  renamed, so the buckets are unchanged. This is deliberate and pinned: SQLite
  resolves output names in `GROUP BY`, so a face that grouped by the alias would
  look correct here and diverge on a dialect that does not.

  `having` needed no change and now means one thing: it is applied over the
  aggregated row's own columns, so a filter on a group projection references the
  alias on every path — previously the alias on one path and the field on the
  other.

  **Conformance.** `AGGREGATION_CASES` (#6409) gains a `groupByAlias` axis and two
  cases. Their VALUES are an existing case verbatim — only the key moves — so they
  can fail only on the key, which is the point: every wrong answer in this area is
  a valid query returning plausible rows. `objectql`'s in-memory fallback is now
  **enrolled** as a fourth face, answering #6409's open question ②: it is the face
  the SQL three were converged onto, so the new behaviour would otherwise be
  pinned against nothing, and reaching it needs no engine at all —
  `applyInMemoryAggregation` is a pure function of rows and an AST.

  **Reverse verification**, predicted before running. Reverting the in-memory face
  to `g.field`: only the two alias cases move and only ONE fails — the degenerate
  `alias === field` case stays green, which is why both are in the table.
  Reverting the harness to read `c.groupBy` instead of `c.groupByAlias ?? c.groupBy`
  — the copied-neighbour mistake: everything passes on an unmodified face, a false
  GREEN, which is the failure mode that would have made the axis vacuous.

  **Frozen drivers (#5499), measured from source, not flipped.** `driver-memory`
  already returned `{ field, alias: node.alias ?? node.field }` and projects under
  the alias — it had independently reached the enforce answer, so it needed no
  alignment. `driver-mongodb` is a recorded DEBT row and the defect is wider than
  `alias`: `buildAggregationPipeline` types `groupBy` as `string[]` and builds
  `groupId[field] = '$' + field`, so a structured node — aliased or not — becomes
  the literal key `"[object Object]"`. It cannot take a structured `GroupByNode`
  at all; `mongodb-driver.ts` passes `(query as any).groupBy`, which is why `tsc`
  never saw it. Tracked on #6814.

  **Compatibility.** A caller who writes `alias` and reads the result under
  `field` on a pushdown path will now find the value under `alias` — which is what
  the key has always meant on the fallback path, and what the chart gate already
  required. Callers who never write `alias` are unaffected: the emitted SQL is
  byte-identical.

  <!-- adr-0087: not-required (no-migration-prescription) Nothing is retired: `GroupByNodeSchema.alias` keeps its declaration, its spelling and its type — it starts being HONOURED by three faces that parsed and ignored it. There is no tombstone to write and no authored metadata to rewrite, so there is no mechanical transform a migration could prescribe: every stack that validated before validates after, unchanged. The behaviour change is in the RESULT of a runtime query (a result-column key moves from `field` to `alias` on the pushdown path, converging on what the in-memory path and the chart publish gate already required), which the ledger has no channel for and no upgrader could apply a codemod to. The bang is on the changeset because callers who read that column by the field name must move, and the measured non-test producer count for the key is zero. -->

- 82397b6: feat(drivers,objectql): `$regex` / `$options` are refused everywhere, and `$icontains` is implemented on the SQL family (#5702)

  The driver half of the #4706 ruling. #5701 landed the contract (the vocabulary,
  the `RETIRED_FILTER_OPERATORS` prescriptions, the shared text case-set) and
  #5710 flipped the last live producer — `plugin-auth`'s ObjectQL adapter, which
  emitted `$regex` on the authentication path — so the refusal can now land
  without breaking sign-in.

  **BREAKING for anyone writing `$regex` or `$options` in a filter.** Both are
  refused on every backend with `INVALID_FILTER` / 400 and a message that names
  the replacement. `$regex` was never a declared operator: `driver-sql` compiled
  it to a LIKE-escaped substring (so `a.b` matched only the literal `a.b`),
  `driver-memory` ran it as a real `RegExp` (so the same filter also matched
  `axb`, and an _invalid_ pattern was caught and answered `false` — zero rows, in
  silence), and `objectql`'s `having` did the same. Write `$icontains` for the
  case-insensitive substring search this was almost always used for, `$contains`
  for a case-sensitive one; a pattern that genuinely needs a regex has no
  filter-level replacement.

  **`$icontains` now runs on the SQL family** — `driver-sql`, `driver-sqlite-wasm`,
  and both of `driver-turso`'s transports (the remote one does not go through
  knex, so it needed its own). It compiles to `LOWER(col) LIKE LOWER(?) ESCAPE ?`
  through the same `applyLike` / `pushLike` that carries the `%` / `_` / `\`
  escaping, as a `fold` parameter rather than a second emitter — a copied emitter
  is where the escape class would have been dropped, and an unescaped `%` matches
  every row. An empty or non-string comparand is refused on the validating walk
  (an empty one matches every row, which widens rather than narrows). On SQLite
  `lower()` folds ASCII only, which IS the contract (#4706 Q1 = A): `$icontains:
'café'` does not match `CAFÉ`.

    <!-- adr-0087: registered filter-regex-options-retired -->

  `driver-mongodb`'s unknown-operator arm was throwing a bare `Error` with no
  `code` and no `status`, three lines from the helper in its own file that sets
  `INVALID_FILTER` / 400 — a 500-shaped body for a 400-class client mistake. It
  now speaks the same envelope as its three siblings.

  Two parts of the ruling are deliberately NOT in this change and stay tracked in
  `scripts/check-driver-conformance.mjs`'s ledger: the `$contains` family's
  case-sensitivity (#4706 Q2 = A) needs SQLite's `LIKE` replaced by a case-exact
  construct in the driver, the RLS lowering and the analytics lowering together,
  or one permission rule compiles to two row sets (#6518); and `$icontains` on the
  JS evaluation faces needs the spec vocabulary to take the operator, which cannot
  happen before `driver-memory` has an arm for it (#6520).

- 3264516: fix(driver-sql,service-analytics)!: 两类无意义比较对象不再编译成「静默空谓词」——`$in`/`$nin` 的对象成员与 LIKE 族的对象比较值一律拒收 (#5234)

  两个形状此前都**编译通过、执行、并给出一个作者没写过的答案**,而且没有任何东西记录这件事:

  | filter                             | 改前                                                                                   | 改后                                               |
  | ---------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
  | `{status: {$in: ['a', {foo: 1}]}}` | 该成员绑不上任何行,查询答得**就像第二个成员从没被写过**                                | `INVALID_FILTER` / 400,点名 `index 1`              |
  | `{status: {$nin: [{foo: 1}]}}`     | `NOT IN ('[object Object]')` —— **一行都没排除**,作者写下的排除悄悄没发生              | 同上                                               |
  | `{name: {$contains: {}}}`          | `LIKE '%[object Object]%'` —— 对一行文本恰好是 `[object Object]` 的记录,**真的命中了** | `INVALID_FILTER` / 400,点名 `StringOperatorSchema` |
  | `{name: {$notContains: {}}}`       | 反过来:为一个没人记录的理由**排除了一条真实记录**                                      | 同上                                               |

  #5041(PR #5223)在 `assertCompilableComparand` 的头注释里把这两个形状写为 "Deliberately NOT
  extended",理由是它们 fail-closed(只收窄结果集)、比 #5041 实测的裸 `TypeError` 低一级。**实测下来这
  两条理由都不成立**:`$nin` / `$notContains` 方向是**放宽**(该排除的没排除,在 read-scope 下即 #5347 /
  #5324 判过的 over-reach);而 `$contains: {}` 给的从来不是「零行」,是**错行**。

  ## 三份实现一起动,否则修完仍是方言

  同一个 `String()` 宽容在本仓有多份;只收紧 `driver-sql` 会变成「哪个面接的就是哪个答案」——
  #5146 / #5332 / #5567 各花一轮消掉的那类分叉。守卫因此落在**每个包自己的收口点**,而不是三个发射器:

  - **`driver-sql`** —— `assertCompilableComparand`,#5041 已有的那一个门。
  - **`service-analytics` 的 `where` 门** —— `filter-normalizer.ts` 的 `fieldLeaves`。它是本包**唯一**的
    leaf 生产者,所以一处拒收同时覆盖三个消费方:`NativeSQLStrategy`(真正执行的语句)、
    `ObjectQLStrategy.generateSql`(`/analytics/sql` 回显)与 `ObjectQLStrategy.convertFilter`(引擎路径)。
    这个顺序是关键而非顺手:`convertFilter` 是**生产者**,在那里 `String()` 会把对象洗成一个类型完全正确
    的 `'[object Object]'` 字符串交给驱动,下游再严格的驱动也永远看不到它该严格的那个形状。
  - **`service-analytics` 的 read-scope 门** —— `read-scope-sql.ts` 的 `compileOperator`,它编译的
    `FilterCondition` 不经过上面那个门。

  `like-pattern.ts` 与 `applyLike` 里的 `String(value)` **原样保留**:它们不再是缺陷所在,因为门前已经没有
  渲染不出来的值能到达。两包的谓词由 `like-metacharacter-escape.test.ts` 逐值互锁——正是该文件已经用来锁
  转义表达式的同一套办法。

  ## 围栏是 allow-list,而且每一条都是实测后决定的

  抄 `driver-turso` `RemoteTransport` 的形状(cloud#1004 / #1058):deny-list 会把下一个被发明出来的值形状
  悄悄放进来,这正是那个 bug 熬过第一次修复的原因。顺带说明,**turso 自 #1058 起就已经拒收这两个形状**,
  所以本地 SQLite 与远程 SQLite 此前对同一条查询给的是不同答案;本次改动把它们收敛到一起。

  留在围栏内的(逐条实测,不是假设):

  - **数字 / 布尔 / `null`**:`{$contains: 5}` → `%5%`、`{$contains: null}` → `%null%` 在 `driver-sql`、
    `driver-memory` 与 analytics 两个面上**今天答案一致**,#5526 还专门把 `null` 这条钉住了。拒收它们是在
    **破坏**一致,不是建立一致——所以只拒**对象**。
  - **`Date`**:turso 的 allow-list 把它作为唯一的对象转换保留,拒收会重新叉开本地与远程。
  - **binary**:`$in` 成员照收(`isBindableComparand` 与写路径 `formatInput` 同一套分类),LIKE 拒收——它
    绑得上但渲染不出作者想要的东西。这就是两个谓词而不是一个带 flag 的原因。
  - **`undefined`**:不可授权(JSON 没有 `undefined`),analytics 门按 #5526 / #5332 归一为 `null` 而非拒收;
    在 `driver-sql` 拒收它会**造出**一个分歧而不是消除一个,故照旧。

  被拒的**数组**是本次唯一一个「拒收即消分叉」的形状:`{name: {$contains: ['al','be']}}` 在 `read-scope-sql`
  (与 `driver-sql`)绑 `%al,be%`,在 analytics 的 `where` 门却绑 `%al%`(它读 `values[0]`,后面的成员被
  静默丢弃)。同一个包对同一条 filter 有两个答案,两个门现在都拒。

  ## 作者需要知道的迁移

  这两个形状本来就没有能用的读法——`filter.zod.ts` 的 `StringOperatorSchema` 早就把 LIKE 族比较数声明为
  `z.string()`,本次只是让声明变成强制(Prime Directive #12,declared = enforced)。改后它们答 400 而不是
  一个错答案;把比较数换成字面值即可。`{$eq: {…}}` **不在本次范围**,仍按 `toSqlBindValue` 绑 JSON(#5526
  钉住的行为)。

- 3172831: fix(drivers): text-operator case folding is the CONTRACT's answer, not the dialect's (#6518)

  The `$contains` family and `$icontains` returned **different rows on different
  databases** for the same filter, because case sensitivity was decided by whatever
  `LIKE` happened to mean on the dialect underneath. Both directions **over-matched**
  — they returned rows the filter excludes, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter (#3948):

  |                              | `$contains` / `$notContains` / `$startsWith` / `$endsWith` — case-SENSITIVE (#4706 Q2 = A) | `$icontains` — folds ASCII ONLY (#4706 Q1 = A) |
  | :--------------------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------- |
  | SQLite / turso / sqlite-wasm | ❌ `LIKE` folds ASCII                                                                      | ✅ `lower()` is ASCII-only                     |
  | Postgres                     | ✅ `LIKE` is case-exact                                                                    | ❌ `LOWER()` folds all of Unicode              |
  | MySQL                        | ❌ follows the column's collation                                                          | ❌ `LOWER()` folds all of Unicode              |

  Read across: **each dialect was already right on the half another one got wrong**,
  which is why neither half could be found from one backend alone.

  ## What now runs

  The construct is chosen per dialect, in one emitter, so the escaping and the fold
  stay a single code path (an unescaped wildcard is a filter bypass, P0 — #5567):

  - **SQLite family → `GLOB`.** `LIKE`'s ASCII fold cannot be switched off per
    statement (`PRAGMA case_sensitive_like` is connection-global, so one query would
    redefine every other query on the connection), and `CAST(col AS BLOB) LIKE ?` was
    measured to match _nothing at all_. `GLOB` is case-exact and brings its own
    escaped class — `*`, `?`, `[` as the self-closing classes `[*]`, `[?]`, `[[]`,
    because SQLite's grammar gives `GLOB` no `ESCAPE` clause. `$icontains` keeps
    `lower()` on both operands, still ASCII-only.
  - **Postgres → `LIKE`, unchanged.** Only the fold moved, from `LOWER()` to an
    explicit `translate()` over the 26 ASCII letters. Measured on a live PostgreSQL
    16 (ICU database): `LOWER('CAFÉ')` is `'café'` — the over-fold — while the
    `translate()` form leaves `É` alone.
  - **MySQL → `LIKE` over `CAST(… AS BINARY)`**, so the comparison is byte-wise and
    no collation decides the case; `$icontains` folds byte-wise over the same binary
    rendering, which is ASCII-only because UTF-8 is self-synchronising.
  - **Any other client** keeps the previous `LIKE` / `LOWER()` shape — it is the only
    form that still runs there — and is recorded as residue rather than left to be
    discovered.

  `driver-turso`'s remote transport carries the twin (it compiles filters itself and
  inherits nothing), and the two transports are now held to the same rows by a
  parity suite that runs the shared `FILTER_TEXT_CASES` on both.

  ## Behaviour change — read this before upgrading

  A filter whose comparand's case did not match the stored text used to match on
  SQLite/turso/sqlite-wasm and may have matched on MySQL. It no longer does:

  ```ts
  // rows: { id: '1', name: 'ACME Corp' }, { id: '2', name: 'acme corp' }
  {
    name: {
      $contains: "acme";
    }
  } // was ['1','2'] on SQLite → now ['2'] everywhere
  {
    name: {
      $icontains: "acme";
    }
  } // ['1','2'] — unchanged, and now correct on PG/MySQL too
  {
    name: {
      $icontains: "café";
    }
  } // was ['3','4'] on PG/MySQL → now ['4'] everywhere
  ```

  If you were relying on `$contains` to ignore case, **write `$icontains`** — that is
  the operator for it, and it now folds the same ASCII-only range on every backend.
  Result sets only ever get NARROWER, never wider, so a filter that was already
  correct stays correct.

  ## Why `minor` rather than `major`

  No declared surface moves. `$contains` still exists, still takes the same
  comparand, and `filter.zod.ts` is untouched — the case-sensitivity this delivers
  was **already published** as the contract by #5701 (`FILTER_TEXT_CASES`, one
  release earlier in this same v17 major), and the drivers were the half that had
  not caught up. This is Prime Directive #12 applied in the direction it points:
  declared = enforced. It is graded the way its sibling #5702/#6549 was graded for
  the same operator family in the same rc cycle, and it registers nothing in the
  ADR-0087 registries because it retires no authorable key.

  ## What is deliberately NOT in this change

  `driver-memory` and `driver-mongodb` still fold case on their query paths — they
  are the #5499 frozen family, so their `FILTER_TEXT_CASES` cells stay honest DEBT
  and are tracked as #6682 (case sensitivity) and #6520 (`$icontains`). The
  `service-analytics` SQL compilers were measured already compliant: they emit
  Postgres-shaped statements, where `LIKE` is case-exact, and that assumption is now
  written down and pinned rather than implied.

### Patch Changes

- ddd075a: refactor(spec,objectql,driver-sql): the autonumber counter readback is one shared pure function, beside the renderer it inverses (#6560)

  `packages/spec` gains `readAutonumberCounter(value, prefix, suffix)`, the declared
  inverse of `renderAutonumber`, and both consumers call it instead of holding their
  own copy.

  **Why the inverse belongs where the composition already lives.** `renderAutonumber`
  composes `prefix + zero-padded(seq) + suffix` and its file header states it is
  "shared by the ObjectQL engine and the SQL driver so both paths render identical
  record numbers". PR #6553 (#6468) had to teach both seeding paths to read a counter
  back out of a stored value — and landed that reading as two hand-written copies of
  the same four lines, one in `packages/objectql`, one in
  `packages/drivers/driver-sql`. That is the exact shape of the defect those copies
  were fixing: two independent readings of one composition rule had already drifted
  into two _different_ wrong answers over one dataset (`001-2026` read as `2026` by
  the engine and `12026` by the driver), so the record-number band a tenant received
  depended on which driver happened to run, and numbers burned that way cannot be
  reclaimed. A cross-package `runtime` parity test caught the drift once; it does not
  force a future single-side edit to run it.

  **What moved and what did not.** Only the ANCHORED rule — the one both sides must
  apply identically — is now spec's: the counter is the digit run at the start of
  what follows the rendered `prefix`, after stripping the rendered `suffix` when the
  value carries it (stripped when it matches, never required to match, since one
  counter spans the years a dynamic suffix renders). Out-of-scope values read as
  `undefined`, which also gives the SQL driver back its JS-side re-check of a `LIKE`
  that matched looser than `startsWith` under a case-insensitive collation.

  The UNANCHORED case (neither affix declared) stays per-side, because the two sides
  deliberately differ there and #6553 preserved both byte-for-byte: the engine reads
  the last digit run, the driver concatenates every digit. Spec returns `undefined`
  rather than pick one — a shared contract that claimed an agreement which does not
  exist would be worse than no shared contract. Each side documents its own fallback
  at its own call site.

  **Zero behaviour change.** Every call site keeps its existing guards and its
  existing result for every input; the `packages/runtime` cross-side parity suite that
  pins the two seeding paths against each other is unmodified and passes as-is, which
  is the evidence the semantics moved without changing. Per the maintainer's ruling on
  #6560 (2026-08-08, twice, re-confirmed 2026-08-10): a non-authorable export — no
  Zod, no new vocabulary, no acceptance-face change — so this is api-surface
  bookkeeping plus two call-site swaps.

- db12b88: refactor(driver-sql): read the autonumber default from the contract instead of a hardcoded fallback (#7263)

  Execution half 3/3 of the maintainer's route-3 ruling on #6555. `{0000}` is now a
  declared contract default (`DEFAULT_AUTONUMBER_FORMAT`, landed with
  `resolveAutonumberFormat` in `@objectstack/spec/data`), so this driver stops
  writing the default down for itself.

  Two sites in `sql-driver.ts` — `initObjects` and the external-object
  registration path — each spelled the same four lines by hand:

  ```ts
  const rawFmt =
    typeof field.autonumberFormat === "string" && field.autonumberFormat
      ? field.autonumberFormat
      : typeof field.format === "string" && field.format
      ? field.format
      : "";
  const fmt = rawFmt || "{0000}";
  ```

  Both are now `const fmt = resolveAutonumberFormat(field);`. That is the whole
  change: one symbol added to an import this file already had, no new dependency,
  and the `#1603` comment about honouring both spellings retired to the resolver's
  own docstring, which carries it.

  **Behaviour-neutral, by construction and by measurement.** `resolveAutonumberFormat`'s
  precedence — canonical `autonumberFormat`, then the `format` shorthand, then the
  declared default, with anything that is not a **non-empty string** counting as
  undeclared — was deliberately taken from these very lines, including their
  truthiness rule (not the engine's `??`). A differential check over 484 field
  documents, spanning both spellings across 22 value shapes (absent key,
  `undefined`, `null`, `''`, non-empty strings, numbers, booleans, `NaN`, arrays,
  objects, a boxed `String`, `Symbol`, function, `BigInt`), found the old
  expressions and the resolver returning the identical string in every case —
  `format: ''`, `autonumberFormat: ''` and the non-string values included, not just
  the happy path.

  Compatibility note, per the ruling: choosing {0000} keeps stored driver-sql data
  undisturbed; engine-fallback deployments flip from bare 1 to 0001 for newly
  issued numbers. Counter continuity itself is unaffected (#6468 pinned it).

  The engine half of the same ruling is #7262; #6555 stays open until it lands, so
  a format-less field still renders `0001` on SQL and a bare `1` on the engine's
  in-memory fallback until then. This half moves neither.

- 6f6fec7: fix(objectql,driver-sql): 自增号播种按声明的 `suffix` 定位计数器,两侧收敛到同一答案 (#6468)

  `autonumberFormat` 允许序号槽 `{0..0}` **后面**还有 token —— `renderAutonumber`
  专门返回 `suffix`,其契约就是 `prefix + zero-padded(seq) + suffix`。这类格式渲染
  出的值**序号不在串尾**:`{000}-{YYYY}` 渲染成 `001-2026`,是很常见的单号写法。

  两侧的播种解析却都假定「串尾的数字就是计数器」,而且各错各的:

  - 引擎兜底播种 `seedAutonumber()` 取整串的**最后一个**数字段 —— 读到的是年份。
    库里三行 `001-2026`/`002-2026`/`003-2026`(真实计数器 3)把计数器播种成 **2026**,
    下一个发出的号直接跳到 `2027-2026`;
  - driver-sql 的 `scanMaxNumericTail()` 把 tail 里**所有**数字拼接后 `parseInt` ——
    同样三行读成 **12026**,下一个号是 `12027-2026`。

  于是**同一份元数据、同一批行,换个驱动号段就不一样**;中间跳过的号已经烧掉,事后
  无法回收。只修一侧会把「两个不同的错误答案」变成「一个对一个错」,跨驱动仍不一致,
  所以两侧同 PR 修。

  **修法:两侧解析器尊重已声明的 `prefix`/`suffix`。** 两个字符串都由调用方从
  `renderAutonumber` 的返回值取得后传入 —— 两侧都不再自行理解格式,driver-sql 只收
  参数(`getNextSequenceValue` 仅多转发一个位置参数,序列逻辑本身未动):

  - **prefix / suffix 任一非空 ⇒ 计数器「有锚」**:取 prefix 之后的**首个**数字段,
    并在该行确实带有声明的 suffix 时先把它去掉;
  - **两者皆空 ⇒ 「无锚」**:各自的既有读法**逐字保留**(引擎取整串最后一个数字段,
    driver-sql 拼接全部数字)—— 无 `{0..0}` 槽的格式渲染的就是串尾裸计数器,而早于
    格式存在的历史值根本没有锚可依。

  **suffix 只在匹配时剥离,绝不要求匹配。** `{000}-{YYYY}` 的计数器 scope 是渲染后的
  **prefix**(此处为空),即全局一个计数器、只有显示的年份在变,所以去年的 `007-2025`
  持有计数器 7,必须计入。把 suffix 下推成 `like '%-2026'` 会把这些行整批漏掉、播种
  **低于**真实 max —— 那正是 #6249 修掉的重复单号伤害,自己再造一遍。因此 SQL 谓词
  保持 `like 'prefix%'`,suffix 只在 JS 侧逐行使用。

  无后缀格式(`D-{0000}`、`{0000}`)两侧本来就正确,行为不变并已 pin 住;#6467 的
  播种扫描结构未触碰。

- 7d1ff75: fix(driver-sql): re-seed a stale autonumber counter instead of burning a number per failed create (#5495)

  `getNextSequenceValue` bootstraps a counter from the data-table `MAX` exactly
  once, in its `if (!existing)` branch; after that the data table is never
  consulted again. Any row landing by a path that bypasses `fillAutoNumberFields`
  — an `isSystem` seed replay, a `preserveAudit` historical import (both
  strip-exempt under #5503 and keeping their explicit numbers), or direct SQL —
  therefore never raises the sequence, and once the counter sits below `MAX` it is
  permanently behind. Every subsequent create collided, burned a number and failed
  the request, until the counter had ground past the seeded range one 409 at a
  time. That is the "one-time storm per database" the filing reported from
  HotCRM's 17.0 GA sweep: 25 consecutive `409 UNIQUE_VIOLATION`s with the
  attempted number climbing by one per failure.

  Measured on `main` @ `86e6f6c`, counter seeded at 10 with rows 11–39 landed by a
  bypass path: **29 caller-visible 409s before a create succeeded** at
  `CASE-00040` on attempt 30. After this change the same fixture serves
  `CASE-00040` on the caller's **first** attempt, and `last_value` reaches 40 by
  one re-seed rather than 29 burns.

  `create()` now re-seeds the counter from the data-table `MAX` and retries
  (bounded, 3 attempts) — but only when it can _prove_ the collision was that
  counter's.

  **Why the proof is not the conflicting column.** The obvious predicate ("retry
  when the conflicting column is this autonumber field") needs
  `uniqueViolationColumn()` (#6544) to name a column, and on a tenanted autonumber
  it never does — for two independent reasons, both measured and both pinned by
  tests. The filing's own message is a composite
  (`UNIQUE constraint failed: crm_case.organization_id, crm_case.case_number`),
  which that export refuses by contract; and what this repo builds today is
  narrower still — ADR-0120 D3 makes the index
  `(COALESCE(organization_id,'__global__'), field)`, an _expression_ index, on
  which SQLite reports `UNIQUE constraint failed: index 'uniq_…'` and names no
  column at all. The "column not determinable" limb is not an edge case on this
  path; it is the only limb that ever runs there.

  All three of `uniqueViolationColumn()`'s states are handled explicitly, because
  collapsing any two of them silently is how a real 409 gets eaten:

  1. a column is named and it is one this driver generated → re-seed and retry;
  2. a column is named and it is not → the duplicate is on a value the **caller**
     supplied, so the original error is rethrown untouched;
  3. no column is determinable → decided from the **data**, not the message: if
     the value this driver just generated is already present in the same tenant
     partition the counter covers, the collision was the counter's. If it is not,
     the error is rethrown. One indexed lookup, on the failure path only — the
     happy path is unchanged.

  No fifth dialect word-list: the judgement is `isUniqueViolationError` +
  `uniqueViolationColumn` from `@objectstack/types`, per Prime Directive #12 and
  the #5841 precedent. The re-seed's `MAX` scan is deliberately not wrapped in a
  `catch`, so a read failure propagates instead of being folded into `0` or a
  stale value (#6114's rule, #5979's family).

  Retrying is confined to the no-caller-transaction case. Inside a caller's
  transaction the sequence `UPDATE` shares that transaction and rolls back with
  the refused `INSERT`, so no number is burned (measured), and on Postgres a
  constraint failure aborts the transaction outright — the caller owns that retry.

  The `getNextSequenceValue` docstring is reconciled rather than left to
  contradict the code: a rolled-back insert burning a number is still by design,
  and that sentence used to read as though it also covered a _persistently
  failing_ insert, which was the defect.

  Inherited by `TursoDriver` (local/replica) and `SqliteWasmDriver`, each pinned
  by its own test rather than assumed from the base class (#6203). Turso's
  **remote** transport is unaffected in both directions: it overrides `create` and
  never enters `fillAutoNumberFields`, so it has neither the defect nor the fix.

- e120a5a: feat(drivers): lower `count_distinct` on the SQL family (#6409)

  `count_distinct` has been declared by `AggregationFunction` since the enum was
  written, and until now no SQL backend compiled it: both faces of the SQL family
  refused it with `NOT_IMPLEMENTED` / 501. A dashboard measure asking for a
  deduplicated count against a SQL datasource got a capability-gap refusal for a
  query that was already correct.

  This is the ENFORCE half of #6188's split ruling (maintainer, 2026-08-07).
  `array_agg` and `string_agg` took ADR-0049's remove leg and left the enum in
  protocol 17 — no SQL backend compiled them and `string_agg` had no single shape
  to lower to. `count_distinct` was deliberately kept on the other side of that
  split, on the strength of having exactly one portable lowering. That lowering
  now exists:

  - **`driver-sql`** — `SqlDriver.aggregate` emits `count(distinct "column")`, on
    every dialect the driver targets.
  - **`driver-turso`** — `RemoteTransport.aggregate` emits the same, on the remote
    path. Both faces in one change, deliberately: `TursoDriver` picks between them
    from `url`, so a lowering that landed on one alone would mean one query
    answering two ways depending on a connection string.

  **Semantics: distinct NON-NULL values of the target column** — the standard
  `COUNT(DISTINCT col)` answer, and the same one `objectql`'s in-memory fallback
  and `service-analytics`'s SQL strategy already give.

  **`field` is now required for `count_distinct`.** `AggregationNodeSchema` makes
  `field` optional because `COUNT(*)` is a real spelling, but `COUNT(DISTINCT *)`
  is a syntax error in every dialect. A `count_distinct` aggregation with no
  `field` is refused up front with `INVALID_QUERY` / 400 and a message naming the
  fix, rather than being sent to the database and coming back as an opaque 500.
  Plain `count` with no `field` still means `COUNT(*)`, unchanged.

  **The refusal message no longer names `count_distinct` as unsupported.** Both
  faces build their "Compiled here:" list from their lowering table, so the
  message now lists it among the functions that work. With this entry the declared
  aggregate vocabulary and the SQL family's compiled vocabulary are the same set.

  **New shared conformance table.** `AGGREGATION_CASES` / `AGGREGATION_ROWS`
  (`@objectstack/spec/data`) is the standard both SQL faces are now run against —
  values over one fixture carrying duplicates and nulls, so a lowering that lost
  the dedup or counted NULL as a value fails on a number rather than passing a
  SQL-string assertion. `driver-memory` and `driver-mongodb` are inside the #5499
  freeze and are not enrolled; the table records what each would answer and why,
  rather than omitting them.

- 45e711a: fix(driver-sql): `bulkCreate` and `upsert` re-seed a stale autonumber counter instead of burning the whole batch (#6943)

  #5495 taught `create()` to re-seed a stale autonumber counter and retry instead
  of burning one number per failed insert. `bulkCreate()` and `upsert()` call the
  same `fillAutoNumberFields` and did not get that fix. They are not, however, the
  same defect as each other — measured on `main` @ `c8ff269`, on a fresh database
  with seeded rows above the counter (the one-time-storm repro constraint #5495
  established):

  **`upsert` is `create()`'s old shape exactly.** Single row, so a stale counter
  costs it one burned number per call: `last_value` walked 1 → 2 → 3 across two
  refused upserts. Its `ON CONFLICT (mergeKeys) DO UPDATE` absorbs a conflict on
  the merge key only; the tenanted autonumber lives under a _different_ unique
  index, so that violation is still raised and still reaches the caller.

  **`bulkCreate` is worse.** Each row reserves its number in its own committed
  transaction and the batch then goes in as ONE insert, so a single colliding row
  burns _every_ number the batch reserved and fails the whole request:

  | 3-row `bulkCreate`, counter at 10, rows 11–39 already present | before                | after                   |
  | :------------------------------------------------------------ | :-------------------- | :---------------------- |
  | caller-visible failures                                       | both calls threw      | **0**                   |
  | rows written                                                  | **0**                 | 3                       |
  | `last_value`                                                  | 10 → 13, then 13 → 16 | 10 → 42, by one re-seed |

  And it is the worst path to leave without recovery: framework#2678 made
  `bulkCreate` the common case for seed/import, and seed/import is exactly what
  _creates_ the staleness — an `isSystem` replay or a `preserveAudit` import keeps
  its explicit numbers and never enters `fillAutoNumberFields` (#5495/#5503).

  Both paths now reuse #5495's machinery unchanged — `collidingAutoNumberReservations`
  for the three-state routing, `autoNumberValueExists` for the data-based
  discriminator (the conflicting column is never determinable for a tenanted
  autonumber), and the forward-only `resyncSequenceToDataMax`. A collision that is
  not provably this counter's is still rethrown untouched, so a duplicate on a
  value the caller supplied still reaches them as its own error.

  **Batch semantics are unchanged, and that is a measurement rather than a
  choice.** `insert(rows[])` is a single statement, so the batch was already
  all-or-nothing — the failed batch above left the table exactly as it found it.
  Re-issuing and retrying the whole batch therefore preserves the existing
  contract: no partial success is introduced, no transaction is opened, and no
  "does a failed row roll back its siblings" question arises, because siblings
  already fail together. Per-row retry inside the batch was rejected for the
  opposite reason — it would have had to split the one statement into N and invent
  partial success where none existed.

  One thing the batch may not borrow from `create()`: `create()` keeps a
  reservation that did not collide, to avoid burning a second number. A batch
  cannot. One that straddles the seeded range has its low rows collide and its
  high rows not, and re-issuing only the collided ones would hand them numbers
  _above_ the kept ones — an intra-batch duplicate the driver would have
  manufactured itself. Re-issue is therefore per counter: every row drawn from a
  counter that went stale is re-issued, and counters that did not go stale keep
  their values, so a co-tenant's rows in the same batch are undisturbed.

  As with #5495, retrying is confined to the no-caller-transaction case. Inside a
  caller's transaction the sequence `UPDATE` rolls back with the refused `INSERT`,
  so nothing is burned and there is nothing to repair (measured on both paths), and
  on Postgres a constraint failure aborts the transaction outright. The caller owns
  that retry.

  `TursoDriver` (local/replica) and `SqliteWasmDriver` inherit both fixes, each
  pinned by its own test rather than assumed from the base class — Turso
  _overrides_ `bulkCreate`/`upsert` to route remote traffic away, so inheritance
  there is a routing fact, not a class fact. Turso's remote transport builds its
  own INSERT and generates no autonumber at all, so it neither has this defect nor
  receives this fix (that gap is #6944).

- 465a0fa: fix(driver-sql): refuse scalar-comparison operators on JSON/multi-value columns with 400 `INVALID_FILTER` instead of answering a silently wrong result

  A `multiple: true` field — and every other `JSON_COLUMN_TYPES` field — is stored by this driver as a **JSON TEXT** column. The equality family lowered straight to SQL against that text with no column-type consultation, so a filter naming such a column compiled, ran, and returned a wrong answer with a `200`.

  **Behaviour change (user-visible).** On a row whose `members` holds `["U1","U2"]`:

  | filter                          | before                                               | after                |
  | ------------------------------- | ---------------------------------------------------- | -------------------- |
  | `{members:{$in:[U1]}}`          | `200`, **0 rows**                                    | `400 INVALID_FILTER` |
  | `{members:{$eq:U1}}`            | `200`, **0 rows**                                    | `400 INVALID_FILTER` |
  | `{members: U1}` (bare equality) | `200`, **0 rows**                                    | `400 INVALID_FILTER` |
  | `{members:{$nin:[U1]}}`         | `200`, **the row it was asked to EXCLUDE** ⚠️        | `400 INVALID_FILTER` |
  | `{members:{$ne:U1}}`            | `200`, **the row it was asked to exclude** ⚠️        | `400 INVALID_FILTER` |
  | `{members:{$lte:U1}}`           | `200`, **1 row** (lexicographic, on the leading `[`) | `400 INVALID_FILTER` |
  | `{members:{$contains:U1}}`      | `200`, 1 row                                         | **unchanged**        |

  **`$nin` is why this is a fix and not a documented footgun.** `members not in ('U1')` is TRUE — the stored text genuinely is not equal to that id — so "exclude these" compiled to "return everything". `$in` fails **closed** (fewer rows than exist, bad but narrowing); `$nin` and `$ne` fail **OPEN**, so any exclusion built on them silently stops filtering and the failure direction is _widening_. A downstream delete-guard written as `plans.find({ where: { assignees: { $in: memberIds } } })` therefore never fired once since it shipped, threw nothing, logged nothing, and type-checked — and a `200` with `[]` is byte-identical to a query that legitimately matched nothing, so no caller had anything to key on.

  **What is refused:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$between`, the bare `{ field: value }` spelling, and the infix spellings the normalised emitter also answers (`=`, `<>`, `in`, `nin`, `not_in`, `notin`, …) — on any column this driver stores as JSON, i.e. `field.multiple` arrays **and** the structured-JSON types (`address`, `location`, `composite`, the file-metadata and multi-option types). The structured-JSON half is included because the mechanism is the JSON-text storage rather than the array-ness: `{address:{$nin:['Beijing']}}` showed the identical fail-open inversion.

  The refusal names the operator, the field, why the column cannot answer it, states that the filter **was not applied**, and prescribes the working spelling. It carries the same ADR-0112 envelope as the unknown-operator refusal (`INVALID_FILTER` / 400), on every face that lowers a filter: `find`, `findOne`, `count`, `aggregate`, `distinct`, and the where-clauses of `updateMany` / `deleteMany`.

  **What does NOT change:** `$contains`, `$notContains`, `$startsWith`, `$endsWith`, `$icontains` — the `LIKE` family matches the serialization as text, and `$contains` (or an `$or` of `$contains` for any-of) is the working membership spelling this refusal points at. `$null` / `$exists` also keep working: the column's presence is a well-formed question whatever it holds. Filters on scalar columns are untouched, and a table this driver was never told about (no registered field types) is unaffected — the gate fires only where the column is KNOWN to be JSON.

  Giving array columns a real membership operator (`$overlaps` / `$containsAny`) is a separate question about the closed `FILTER_OPERATORS` set and is deliberately not answered here.

- 6de592c: fix(driver-sql): judge unique violations with the shared predicate, so a Postgres index build over dirty data no longer takes the boot down (#6543)

  `syncDeclaredIndexes` has a branch whose whole job is to keep a database
  BOOTING when existing rows violate a NULL-safe unique it was asked to create
  (the #5030 defect made data): the constraint is logged at `error` as not
  enforced, and the ADR-0120 D4 drift pre-flight reports the exact conflicting
  rows. Taking the process down instead would brick the deployment.

  It decided whether it was looking at that case with a private inline regex over
  the stringified message — `unique constraint failed|duplicate entry|duplicate
key value`, the fourth hand-written spelling of this question #6250
  inventoried. That read one of the two channels drivers use, and on the DDL path
  the missing channel is the whole answer for one shipped dialect:

  | dialect  | `CREATE UNIQUE INDEX` over duplicate rows says           | old regex  |
  | :------- | :------------------------------------------------------- | :--------- |
  | SQLite   | `UNIQUE constraint failed: product.code`                 | matched    |
  | MySQL    | `ER_DUP_ENTRY: Duplicate entry 'DUP' for key 'uniq_…'`   | matched    |
  | Postgres | `could not create unique index "uniq_…"`, SQLSTATE 23505 | **missed** |

  Postgres does not reuse its DML phrasing for an index build: `duplicate key
value violates unique constraint` is what a conflicting INSERT says, while a
  conflicting index BUILD says `could not create unique index "…"` and puts the
  verdict on `error.code` (SQLSTATE `23505`) with the offending tuple on
  `error.detail`. None of the three message limbs appear in it — so on Postgres
  the branch never fired, and a database with legacy duplicates failed to start
  rather than booting with the constraint reported as unenforced.

  Both discriminators in this file now call `isUniqueViolationError` from
  `@objectstack/types`, passing the **error object** rather than a pre-stringified
  message, so `code`, `errno` and the `cause` chain are read alongside `message`:

  - the #5030 boot-survival branch above;
  - the negative limb of the MySQL functional-key-part fallback in
    `createNullSafeUniqueIndex`, which used a bare `/duplicate/i` to avoid
    degrading a conflict into a "this server rejects functional key parts"
    verdict — a message-only exclusion that did not fire on the `errno`-only
    shape mysql2 can hand back.

  `patch` rather than `minor`: no API changes, and the message spellings that
  were recognised before are a strict subset of what the predicate recognises, so
  nothing that was absorbed before is absorbed differently now. The site's own
  business logic — the `nullSafe.size > 0` guard that keeps this absorption
  scoped to the NULL-safe case, and the "already exists" race arm that runs ahead
  of it — is unchanged.

- d254421: fix(driver-sql): a merge-path `upsert` no longer rewrites an existing row's autonumber (#7011)

  Measured on a completely healthy counter, single row throughout:

  ```
  create                      → CASE-00001    last_value 1
  upsert same id (1st time)   → CASE-00002    last_value 2
  upsert same id (2nd time)   → CASE-00003    last_value 3
  ```

  `fillAutoNumberFields` reserves a number before the statement knows whether it
  will insert or merge, and the autonumber column sat in `mergeColumns` — so
  every `ON CONFLICT … DO UPDATE` wrote the freshly reserved number over the
  row's existing one, silently replacing an externally visible business
  identifier the caller never asked to change.

  Per the triage ruling on the card: an autonumber is an **immutable business
  identifier once assigned**. `auto_number` columns are now excluded from the
  merge column list, exactly like `created_at` (both are insert-only facts about
  the row's birth). After the fix the same sequence keeps `CASE-00001` through
  both upserts. The exclusion is unconditional — an explicit autonumber value in
  the upsert payload does not renumber an existing row on the merge branch
  either; `update()` writes what it is given and remains the deliberate
  renumbering path. Insert-path upserts still assign fresh numbers, and every
  non-autonumber column (including `updated_at`) merges as before.

  Deliberately out of scope (#6943's reseed family): the reservation itself still
  happens before insert-vs-merge is known, so a merge-only upsert still consumes
  one sequence value per call — now a permanent gap in the sequence rather than a
  rewrite of the row (measured post-fix: row keeps `CASE-00001`, `last_value`
  walks 1 → 2 → 3, the next inserted row gets `CASE-00004`).

  Covered faces: `SqliteWasmDriver` inherits `upsert` unchanged; `TursoDriver`
  local/replica routes its override to `super` — both pinned by their own tests.
  Turso remote (`RemoteTransport.upsert`) never enters `fillAutoNumberFields` and
  has neither the defect nor the fix. Rows already renumbered by past merges
  cannot be restored from the driver side.

- ef678d0: fix(driver-sql): a failed index read is an error, not an empty index list (#7332)

  `SqlDriver.introspectIndexes` wrapped its **entire** dialect dispatch — the
  SQLite, Postgres and MySQL branches alike — in one bare `catch {}` and then
  returned its accumulator in whatever half-built state it had reached. The caller
  could not tell _"this table genuinely has no such index"_ from _"the read failed
  and I am guessing"_.

  Drift detection consumed that same function. `diffManagedIndexes` takes its
  declared-index-missing branch on exactly that input, so a transient failure —
  SQLITE_BUSY, a WAL read landing mid-flush, any I/O hiccup — was not surfaced as
  an error. It was laundered into a confident, specific and **false** report:

  ```
  product: metadata declares index 'idx_product_code' (code) but the database
  has no such index — run "os migrate apply" to create it.
  ```

  …about an index that was there the whole time.

  **The swallow is kept where its justification holds, and only there.** That
  justification — _"let creation handle conflicts"_ — is sound at
  `getExistingIndexNames`, whose caller `syncDeclaredIndexes` corrects an
  optimistic wrong reading by attempting the create and absorbing the
  "already exists" error; a throw there would take a whole boot down on a
  transient read. Detection has no such backstop, and inherited the swallow only
  because #3728 wired a second consumer onto the same function. `introspectIndexes`
  therefore now **throws by default** and takes an explicit
  `{ onFailure: 'partial' }` opt-in, which the creation seam passes and nothing
  else does.

  **What changes for you.** Nothing on the creation path: boot still tolerates a
  failed index read and still converges the schema. On the detection path, a
  failure that was previously invisible is now reported as one — `os migrate plan`
  and `os migrate apply` print it and exit non-zero instead of rendering a plan
  built on a partial reading, and boot-time drift handling logs
  `could not introspect '<table>' for drift detection` (a handler
  `reconcileAndWarnDrift` already carried) instead of a false drift warning. This
  matches the sibling read in the same detect path, `introspectColumns`, which has
  never swallowed.

  Measured, and worth stating plainly: no consumer ever acted **destructively** on
  the false reading. Dropping entries from the physical list is monotone — the
  `replace_unique_index`, `drop_index` and `recreate_index` remedies all require an
  index to be _present_, so a short read can only ever remove a destructive
  proposal, never arm one. The defect was a confidently wrong report, not a
  dangerous one.

- 8825a06: drivers: `limit: 0` returns no records, on every driver and every read door

  `limit: 0` was ruled in #6485 to mean **return no records**. Three of the five shipped
  drivers did not honour it, in three different ways — and the ones that disagreed
  returned **more** data than was requested, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter. Reachable since #6578: the client now puts
  `top=0` on the wire, so the answer depended on which driver a deployment configured.

  **`driver-memory` — the slice was dropped.** `find()` sliced with `if (query.limit)`,
  truthiness, and `0` is falsy. Measured before the fix, three rows seeded:
  `{ limit: 0 }` returned **3 of 3**, and `{ limit: 0, offset: 1 }` returned 2 — the
  OFFSET applied and the LIMIT silently did not, which is why every paging suite stayed
  green over it. Two more sites of the same shape in `memory-analytics.ts` (the `$limit`
  pipeline stage and the SQL string builder) moved with it. Mingo honours `{ $limit: 0 }`
  as zero records (measured), so presence is sufficient there.

  **`driver-mongodb` — the value was forwarded faithfully, to a client that means
  something else by it.** `buildFindOptions` already tested presence, so `0` arrived
  exactly as written — but the MongoDB Node driver DEFINES `limit: 0` as _no limit_, so
  the answer was still the whole collection. Fixed with an explicit short-circuit that
  returns the empty result **before the client is consulted** (`[]` from `find`, `null`
  from `findOne`, which had the same hole). No round trip is made for a query whose
  answer is already known, and no future change in the upstream driver's reading of `0`
  can move this behaviour. Deliberately `=== 0`, not `<= 0`.

  **`driver-sql` — two doors disagreed with a third.** `findRows()`, the door `find()`
  goes through, has always compiled `limit` on presence. Two others compiled it on
  truthiness:

  - `findWithWindowFunctions()` — the live window-function read door (#4286). Returns
    rows, so this was user-visible wrong data: `{ limit: 0 }` returned the whole table.
  - `analyzeQuery()` / `explain()` — returns a plan. It compiled `select * from "orders"`
    where `find()` sent `... order by "id" asc limit ?`, so it explained a statement
    other than the one that would run.

  `offset` moved with `limit` at both doors for internal consistency only. That half is
  **measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
  and MySQL alike. It is pinned as the no-op it is rather than reported as a fix.

  **`driver-turso` remote transport — an `OFFSET` with no `LIMIT` was a syntax error.**
  Surfaced by the new conformance control that reads with a bare offset. SQLite's grammar
  is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses independently,
  so `find(obj, { offset: N })` with no `limit` produced `near "OFFSET": syntax error` —
  for **every** `N`, and only on the remote transport (the local half goes through knex,
  which synthesises the `LIMIT -1` no-limit sentinel). Remote now builds the same
  statement knex does.

  Result sets only ever get **narrower**. A caller who wants every row should omit
  `limit` rather than pass `0`.

  `@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
  case-set pinning this — with controls, so "return nothing, always" cannot pass it. All
  **five** drivers answer it, with **no DEBT rows**: future drift goes red at
  `check:driver-conformance` rather than being discovered in production.

- 6146b67: `os migrate plan` no longer creates a database on a project that has never been started (#6743)

  `migrate plan` is a dry run, and since #3917 it has reported the boot-time
  create-table DDL and the artifact seed instead of performing them. It still
  brought the database file itself into existence, though: SQLite creates the
  file at open, so a `plan` in a fresh project left behind a 0-table
  `.objectstack/data/objectstack.db` — a write side effect from a read-only
  command, and one that erased the only signal ("no database file yet") by which
  the next command can tell a never-started project from a started one.

  A missing SQLite target is now opened as an empty in-memory database instead of
  being created. **The plan output is unchanged**, deliberately: a database with
  zero tables is exactly what a freshly created empty file is, so "every table
  needs creating" — the true and useful answer for a new project — still prints,
  and the `Database:` line still names the real target path rather than the
  in-memory stand-in.

  New driver capability, additive and off by default:
  `SqlDriverConfig.sqliteAbsentFile` (`'create'` | `'empty-in-memory'`, default
  `'create'`). Every existing caller keeps SQLite's own create-if-absent
  behaviour. It is threaded to the driver as a host-composition option
  (`createDefaultDatasourceDriverFactory`, `DefaultDatasourcePlugin`,
  `createStandaloneStack`), not as an authorable `datasource.config` key — a
  datasource must not be able to declare itself into never persisting.

  `os migrate apply` deliberately does **not** use it: it boots deferred too, but
  flushes the deferred DDL after confirmation and needs a real file to flush into.

- 3510e4a: refactor(spec,drivers,lint): one implementation of the filter identity reduction (#5659)

  `{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
  disjunct that absorbs its `$or`, `{ $not: {} }` is FALSE. That is a ruling
  (#5322/#5134) pinned for every backend by the four identity cases in
  `FILTER_LOGIC_CASES` — and it was implemented four times over: `reduceFilterNode`
  in `driver-sql`, the same function again in `driver-mongodb`, the
  `every`/`some`/truthiness algebra of `driver-memory`'s matcher, and nearly a
  fifth hand-written copy inside `@objectstack/lint`, which declined to write one
  and filed this issue instead.

  **New in `@objectstack/spec` (`@objectstack/spec/data`): `reduceFilterVerdict`**,
  beside the case table that proves it. It answers `'true' | 'false' | 'clause'`
  for a filter node and never throws on its own; each backend's own refusals — the
  undeclared `$`-combinator and the `undefined` comparand in `driver-sql`, the
  query-level keys and the `$null` comparand in `driver-mongodb` — are passed in as
  `FilterVerdictHooks` and are invoked from exactly the positions they were invoked
  from before. `reduceFilterKeyVerdict` answers the same question for one key, which
  is what both SQL and MongoDB emitters consult while walking a node.

  **No behaviour changes in the three drivers.** The move is mechanical: the shared
  algebra replaces each private copy, the refusals stay where they were, and the
  `FILTER_LOGIC_CASES` conformance suites are green on both sides of the change —
  including the SQL-inheriting `driver-sqlite-wasm` and `driver-turso`.

  **`@objectstack/lint` gains two warnings it was structurally blind to.** The
  `multi: true` unbounded-bulk-write rule (#5482) asked "does this filter have zero
  keys", so a `delete_record` bounded by `filter: { $and: [] }` or
  `filter: { $or: [{}] }` — a whole-object write by the ruling every driver executes
  — passed silently. It now asks the reduction, and it warns about both while
  staying quiet on `{ $or: [] }` and `{ $not: {} }`, which match nothing. The
  message names the shape it saw (`a filter that REDUCES TO TRUE ({"$and":[]})`)
  rather than calling a non-empty filter "empty".

  If you have a flow declaring a bulk write bounded by one of those two shapes, the
  lint will now tell you so — the write was already unbounded at run time; only the
  feedback is new.

- bee5ffe: drivers: every SQL read door routes through the tenant chokepoint (#6792)

  `SqlDriver.applyTenantScope()` owns read-side tenant isolation for the whole SQL family —
  the `tenantId` early-out, the "object has no tenant field" early-out, the NULL-org
  platform-row rule (#2734) and the ADR-0105 D2 union posture (#3623). Its own docstring
  said "every CRUD method routes through it". Nothing ever checked that, and it was false
  for as long as it had existed. **Three** read doors built their query through
  `getBuilder()` and never arrived:

  - **`findWithWindowFunctions()`** — the documented #4286 window door. It returns **rows**,
    so on a deployment where the scope would have applied (`options.tenantId` set, object
    has a tenant field) it returned rows belonging to **every** tenant. Measured with two
    tenants seeded plus one NULL-org platform row: `tenantId: 'org_a'` returned
    `[a1, a2, b1, b2, p1]` here against `find()`'s `[a1, a2, p1]` — another tenant's rows,
    handed over at the driver layer.
  - **`analyzeQuery()` / `explain()`** — returns a **plan**, not rows, so this is a smaller
    fix and it is made on its own merits rather than folded into the one above. It is the
    same defect #6577 fixed on these two methods one builder line lower: a plan is only
    worth reading if it explains the statement `find()` would actually run, and a missing
    tenant predicate changes selectivity and therefore which index the planner picks.
    Compiled `select * from account` where `find()` sent the `organization_id` clause.
  - **`distinct()`** — returns one column's **values** for every tenant. This one was in no
    card. #6792 states the opposite, listing `distinct` among the scoped call sites; the
    13th read site is `aggregate()`. It was found by measuring the invariant rather than
    re-reading it.

  All three now call `applyTenantScope()` beside their `getBuilder()` line, the position
  `findRows()` uses. They route through the chokepoint rather than re-deriving a predicate:
  a local equality would silently drop NULL-org platform rows (#2734) and collapse group
  reads to active-org reach (#3623). Both of the chokepoint's early-outs are inherited
  unchanged, so an unscoped admin/seed read (no `tenantId`) and any object without a tenant
  field behave exactly as before.

  **The durable half is a gate, not the three lines.** `pnpm check:tenant-chokepoint`
  (`scripts/check-tenant-chokepoint.mjs`, wired into `.github/workflows/lint.yml`) re-derives
  the invariant from the AST across the `SqlDriver` family on every run: a method that builds
  through `getBuilder(object, options)` must call `applyTenantScope()` on that builder, or
  carry a written exemption. Insert builders are exempt structurally — write-side tenancy is
  `injectTenantOnInsert` — rather than by a name list. It is keyed on the **builder** and not
  on the method signature, because the signature criterion the card sketches ("takes
  `(object, …, options)` and returns rows") misses `distinct` (no `query` parameter) and
  `analyzeQuery` (returns a plan). Verified red against the pre-fix tree, red against a
  newly-added unscoped door, and silent once that door is scoped.

  The chokepoint docstring no longer asserts the invariant; it names the gate that proves it.

  If you call these doors directly on a multi-tenant deployment, pass `options.tenantId` as
  you would to `find()` — that is what now takes effect. Callers that never passed it are
  unaffected; that remains the documented unscoped/admin path.

- 939f579: drivers(sql,turso): 聚合函数拒收带上 ADR-0112 信封,并把两类条件分开措辞

  `SqlDriver.mapAggregateFunc()` 与 `RemoteTransport.aggregate()` 此前对同一条件各抛一个裸
  `Error`(`code`/`status` 皆 `undefined`),`mapDataError` 因此落默认分支——一条本该 4xx 的
  调用方错误以不透明 500 到达客户端。两处同时改,同一信封体例、首句逐字一致(#5240):

  - **协议未声明的函数名**(如 `median`)→ `INVALID_QUERY` / 400。这正是协议门
    (`metadata-protocol` 的 `invalidQueryError`,#4254)对同一条件已经给出的码,于是
    进程内调用方与 REST 调用方读到同一个答案。
  - **协议已声明、本后端编不出**(`count_distinct` / `array_agg` / `string_agg`)→
    `NOT_IMPLEMENTED` / 501。这是能力缺口而不是调用方的错(`driver-mongodb` 编得出这三个),
    措辞明确说明查询拼写无误,不把作者说成打错字。

  两面都只改拒收的身份:编得出的五个函数生成的 SQL 逐字节不变。

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6
  - @objectstack/observability@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/observability@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- 0f17114: fix(driver-sql,driver-memory,formula)!: `{ field: {} }` 一律拒收 —— 零个操作符的字段约束不再在四个后端有三个答案 (#5240)

  `{ a: {} }`(一个字段,后面跟零个操作符)是 `FilterConditionSchema` 今天**声明合法**的形状,
  而同一个 filter 在同仓四条路径上有三个答案:

  | 路径                                | 改前                                                                                            | 改后                          |
  | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
  | `driver-sql`,顶层 plain map         | 抛 `INVALID_FILTER`(#5041 的比较数闸门)                                                         | 抛 `INVALID_FILTER`(专用消息) |
  | `driver-sql`,`$and`/`$or`/`$not` 内 | 遍历零个操作符 → 不产出任何 SQL → **TRUE(匹配全表)**                                            | 抛 `INVALID_FILTER`           |
  | `driver-memory`                     | 实时路径经 mingo 变成「字段深等于空文档」;参考匹配器落到 `JSON.stringify` 结构相等 → 顺带 FALSE | 抛 `INVALID_FILTER`           |
  | `@objectstack/formula`              | `keys.length === 0` 显式 fail-closed → FALSE                                                    | 抛 `INVALID_FILTER`           |

  于是 `{ $or: [ { a: {} }, { b: 2 } ] }` 在 SQL 上编译成 `(b = 2)` —— 既不是「零约束即 TRUE」
  该给的全表,也不是两个 JS 后端给的 FALSE,而是**子句被 knex 连同空分组一起丢掉**的结果;
  而 `driver-sql` 自己内部就不自洽:同一个 `{ a: {} }` 写在顶层被响亮拒收,包进一层 `$or`
  就变成静默的 TRUE。

  维护者拍板取**拒收**(不取 TRUE、不取 FALSE):这个形状几乎必然是编写期事故 ——
  筛选器记下了字段却没记下操作符,或生成的元数据把操作符弄丢了 —— 让它在编写期就炸,
  好过在某个后端上安静地多返回或少返回几行。与 #5041 已在 driver-sql 顶层建立的先例一致,
  本次只是把同一道闸门补进组合子内部。四个后端(第四个是继承 `SqlDriver` 的
  `driver-sqlite-wasm`)现在给出同一个 `INVALID_FILTER` / 400,消息里指名出事的位置
  (如 `filter.$or[0].stage`)。

  **⚠️ 可观察的行为变更 —— RLS `check` 求值路径。** `@objectstack/formula` 的
  `matchesFilterCondition` 是 `plugin-security` 对 insert/update **后像**执行行级 `check`
  的那条路径(没有查询可下推,这个求值器就是执行本身)。它改为抛出后,落在 #4775
  「求不出值 = 该次操作失败」的既定姿态上。这不只是「拒绝得更响」——有一类结果直接翻转:

  | `check` 策略                                    | 改前                                  | 改后                     |
  | ----------------------------------------------- | ------------------------------------- | ------------------------ |
  | `{ a: {} }`                                     | FALSE → 写入被拒(403)                 | 抛出 → 该次写入失败(400) |
  | `{ $or: [ { a: {} }, { owner: '{userId}' } ] }` | FALSE 被另一析取项吸收 → 写入**放行** | 抛出 → 该次写入失败      |
  | `{ $not: { a: {} } }`                           | `!false` → 写入**放行**               | 抛出 → 该次写入失败      |

  后两行是**原本能成功、现在会失败**的写入。这是拍板的目的而非副作用:一条含
  `{ field: {} }` 的权限规则,是一条作者弄丢了操作符的规则,它的含义不该取决于四个后端里
  哪一个在求值。升级后请检查 `check`/`using` 策略里是否存在零操作符的字段约束——
  错误消息会指名位置。

  同一条改动也让 `@objectstack/driver-memory` 的两个过滤面(经 mingo 的实时查询路径,
  与跨后端一致性套件所用的 `memory-matcher` 参考匹配器)第一次对这个形状给出同一个答案。

  非空形状**逐字符不变**:普通比较、`$in`、`$or`/`$and` 组合、`$not` 的 #5146 NULL-safe 改写,
  编译出的 SQL 文本与匹配结果都与改前相同;`{}`(零个键的**节点**,#5134 的布尔单位元)
  与 `{ field: {} }` 是两个不同形状,前者的语义不受本次影响。

  注:本次收紧的是**实现**。`packages/spec` 的 `FilterConditionSchema` 仍然声明这个形状合法
  (非递归半边是 `z.record(z.string(), z.unknown())`),即实现现在比已声明的契约更严;
  契约收窄与 `FILTER_LOGIC_CASES` 补条归 spec 车道另行处理。

- c7406b0: fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

  `FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
  授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
  钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

  ## 改了什么

  进入运行时的门有两扇,过去只有一扇按契约读:

  | 门                                                                                                | 改前                                                                                                                               | 改后                                                                                            |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | **Door 1** —— 协议/HTTP 面(`metadata-protocol`)                                                   | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER`                                                             | 不变                                                                                            |
  | **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动                                                                                                             | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
  | 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`)            | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400                                              |

  一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
  `RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
  删掉方言后两侧自然合流。

  ## 授权面:零变化

  `FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
  `filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
  这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

  ## ⚠️ 可观察的行为变更

  1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
     声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
  2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
     照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
     `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
     返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
  3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
     变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
  4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
     导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
     注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
     挡住这个输入,所以拒收必须在运行时。
  5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
     (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
     AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

  ## 删除的代码面

  - `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
  - `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
  - `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
  - `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

  `[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。

- 4addd9d: feat(driver-sql)!: organization-scoped uniques are NULL-safe — `COALESCE(organization_id, '__global__')` key part + `unique: 'organization'` on declared indexes (ADR-0120 D3/D4, #5030)

  SQL UNIQUE is NULL-distinct, so the `(organization_id, field)` composite #3696
  introduced enforced **nothing** on rows whose organization is NULL — which on a
  single-tenant stack (where the kernel injects the column and never fills it) is
  **every row**: field-level `unique: true` was a silent no-op there, measured in
  #5030. Per ADR-0120 D3, every organization-scoped unique now materializes its
  organization key part as `COALESCE(organization_id, '__global__')`: NULL-organization
  rows collapse into one platform bucket, unique among themselves; non-NULL rows
  are untouched. Storage stays NULL — the sentinel exists only inside the index
  key, and it is the same word the autonumber sequence table already uses
  (`GLOBAL_TENANT`), so a constraint-violation error reads as "the platform
  bucket collided", not as corrupt data.

  What changes, concretely:

  - **Field-level `unique: true`** (and the new explicit synonym
    `'organization'`) on a tenant-scoped object → composite
    `(COALESCE(tenantField, '__global__'), field)`. `unique: 'global'` and
    tenant-less objects are unchanged.
  - **Declared indexes gain the ADR-0120 D1 scope vocabulary at the driver**:
    `unique: 'organization'` prepends the NULL-safe organization key part to the
    listed columns (degrading to the listed columns on a tenant-less object; a
    listed tenant column is made NULL-safe in place instead — the S6 respelling).
    `unique: true` / `'global'` on a declared index stays **verbatim** — the
    #3696 contract, now the `'global'` arm; the nine engine dedup/idempotency
    keys keep their exact physical shape. (The spec/lint side of the vocabulary
    lands separately via #4986; the driver deliberately merges first.)
  - **Drift detection reads both sides through one normalization**
    (the #4884 discipline, extended to the tenant key part): the physical
    `COALESCE(organization_id, <literal>)` form is attributed to the column,
    compared **literal-agnostically**, and recognised as the sync's own
    vocabulary — a healthy database reports zero drift on every dialect.
  - **Existing bare composites migrate through the ceremony (ADR-0120 D4)**:
    `(organization_id, X) → (COALESCE(organization_id, '__global__'), X)`
    surfaces as a `recreate_index` drift op — a pure tightening — gated by a
    **duplicate pre-flight probe**. Clean probe → the op grades `safe` and dev
    `autoMigrate: 'safe'` / a plain `os migrate apply` applies it. Duplicates
    (data the void constraint wrongly admitted) → the op is **blocked** with a
    per-group row report, the old index stays in place, and apply re-probes so
    even `--allow-destructive` cannot drop a constraint whose replacement is not
    creatable. Deduplicate, re-plan, apply.
  - **`'__global__'` is reserved at the organization-minting seam**
    (plugin-auth): an organization whose id or slug equals the sentinel is
    rejected at creation with a prescriptive error (ADR-0120 D3 guardrail).

  Migration note for operators: on databases with pre-existing
  organization-composite uniques, the first `os migrate plan` after upgrading
  shows one `recreate_index` per affected index. On healthy data it auto-applies
  in dev and is a no-op content-wise; a blocked op means the #5030 defect
  admitted real duplicate rows — resolve the listed rows first. MySQL < 8.0.13 /
  MariaDB cannot express the functional key part: the driver degrades to the
  bare composite, says exactly what is not enforced at `error` level, and keeps
  reporting the tightening as drift for after the server upgrade.

### Patch Changes

- 28ad90e: feat(types,cloud-connection,lint,cli): ADR-0120 17.x 收尾 —— `isolated` 安装期姿态硬门(D5e)、D5c 重拼写 advisory、成文契约扫荡与三姿态 conformance (#5081)

  ADR-0120 17.x 波的第三块,也是最后一块。前两块已在 main 上:#5212(driver 侧
  D3+D4 —— `COALESCE(organization_id, '__global__')` 物化、drift 两侧同步、重复预检)
  与 #5208(spec 词汇 `'organization'` + D5a/D5b lint)。本次补齐三件事:安装期的
  姿态决策点、剩余的成文契约、以及把「一个 app 包跑遍三种姿态」从假设变成测试。

  **D5e —— 装进 `isolated` 环境时的硬门。** 词汇本身是姿态无关的:作者说的是业务
  边界(`'organization'` 一个组织一份 / `'global'` 整个安装一份),没有任何索引形状
  读姿态。唯一的残留在一个方向上:`isolated` 下组织就是**不同客户**,此时 app 业务
  对象上的 `'global'` 唯一既跨客户过度约束,又变成跨客户的存在性预言机(S10/S14)。
  维护者裁定这是**硬门而非 advisory**:把带 `'global'` 唯一(非 `sys` 对象)的 app
  装进 `isolated` 环境会**停下来并逐索引列出**,安装者(通常是 AI agent)要么确认它
  确实是平台级的,要么改写为 `'organization'`;确认按 ADR-0104 attestation 风格
  留痕在安装清单里(`InstalledManifestEntry.globalUniqueAttestation` —— 确认了什么、
  谁确认的、何时、在哪个姿态下问的),**之后不复问**。

  - 停下的安装**什么都不留**:先于 hot-register 和任何 ledger 写入,所以作者改完
    元数据可以直接重试,不需要先卸载。
  - 逐索引确认是有牙齿的:`confirmGlobalUniques` 收 `true` 或明确的 id 数组,只确认
    其中一条仍会在剩下的那条上停住。
  - 升级引入的**新**约束会被问,老的答案继续算数。
  - 另一个姿态下给出的确认**不算同意** —— `isolated` 那个问题在 `single` 下从未被
    问过,所以按「未确认」处理(唯一不会静默放行跨客户约束的方向)。
  - ⛔ **永不做成启动期告警**(#4884 纪律)。boot 时的 rehydrate 不评估此门;门够不到
    的两类存量 —— 门禁上线前的安装、装后姿态变更的环境 —— 由 `os doctor` 与
    `os migrate plan` 的 advisory 形态覆盖。

  判定里有三条是承重的,别「简化」掉:声明索引上的裸 `unique: true` **算**(D1 说它
  就是 `'global'` 的位置式拼写,排除它等于让整个 17.x 可以靠拼写绕过);字段级
  `true` **不算**(它是 `'organization'`,永久合法);`sys_`/`base_` 对象**不算**
  (S5 那批引擎幂等键天然就是平台级的,每次安装都问一遍就是 #4884 的误报类)。

  CLI: `os package install` 新增 `--confirm-global-uniques`,并把 409 渲染成可读的
  逐条清单而不是一句 "Install failed (409)"。

  **D5c —— 遗留手写组织复合索引的 advisory。** 新规则
  `unique/legacy-organization-composite`:声明的唯一索引自己列出了组织列
  (`{ fields: ['name','organization_id'], unique: true }`)—— 这是词汇出现之前手写
  per-organization 的写法。它读起来像「每组织唯一」,物化出来却是普通复合索引,而
  SQL UNIQUE 是 NULL-distinct 的:组织列为 NULL 的行上它**什么都不约束**(#5030),
  在单组织部署上那就是每一行。改写成 `unique: 'organization'`(`fields` 原样保留,
  driver 会把已列出的组织列**就地**变成 NULL-safe 形式)正是补上这个洞的动作。
  **永远只是 advisory,永远不自动修**:老拼写永久合法、零强制 drift,而 opt-in 是
  真实的物理收紧,要走 D4 的 `recreate_index` + 重复预检。

  **D6 —— 成文契约扫荡。** `content/docs/data-modeling/indexing.mdx` 的
  §Two ways to say "unique" 全节按新词汇重写(含 `os:check` 代码块);
  `content/docs/protocol/objectql/schema.mdx` 的 §Uniqueness and tenancy 重写为
  §Uniqueness and scope —— 其中那句「单租户部署不受影响,租户列是常量,复合索引
  退化为单列索引」是 #5030 **证伪过的原话**,现已替换为 D3 的 NULL-safe 事实;
  `content/docs/deployment/cli.mdx` 的 `replace_unique_index` / `recreate_index`
  条目补上 NULL-safe 形状与重复预检;`content/docs/references/**` 经
  `gen:schema && gen:docs` 再生成,未手改。

  按 ADR-0120 Resolved #2 的非规范性引导(官方示例/脚手架/生成器在新代码中输出
  显式拼写),`skills/objectstack-data/**` 的索引与校验规则整体扫过:声明索引一律
  说清 scope,并新增一节完整讲 `'organization'` 的 NULL-safe 语义与「永远不写姿态」。
  顺带修掉那里长期使用的 `tenant_id` —— 平台的列叫 `organization_id`。
  `examples/**`、`create-objectstack` 模板与 `os generate` 经核查**根本没有声明任何
  唯一约束**,故无可扫;这是核查结论,不是遗漏。

  **三姿态 conformance(ADR §Acceptance tests)。** 同一个 fixture app 在
  `single | group | isolated` 三姿态下启动,逐 S 行用**真实的违规插入**断言 enforcement
  (S1/S2/S3/S4/S5/S6/S7/S8/S9/S11/S12),并逐姿态捕获物化出的索引键,断言三者
  **逐字节相同** —— 「没有任何索引形状读姿态」这句话一旦有两者不同就是假的。相同性
  断言配了一条正向断言(对着期望的键形状),这样「三次都什么都没建」不会读成「一致」。
  外加 ADR 只要的那一条 transition smoke:在 `single` 下建库、`isolated` 下重新打开,
  drift op 为零。

  对既有部署的影响:除新增的安装期确认外,本次不改变任何已有物化行为。字段级
  `unique: true` 一如既往合法。

- 06ba036: feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

  `TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
  `objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
  公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
  的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
  `fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
  在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

  **新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
  带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
  `RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
  驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
  不要凭据（remote 面走包内的 sqlite stub）。

  **留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
  `vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
  `MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
  一部分，只是曾经同包而已。

  **目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
  `driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
  `knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
  `repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

  这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
  迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
  filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
  `LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
  补齐工作跟踪在 #5590。

- d9971d3: fix(driver-sql): `$field` 跨字段比较改为按 ADR-0112 响亮拒绝,不再抛裸 TypeError

  `{ amount: { $gt: { $field: 'budget' } } }`(spec `FieldReferenceSchema`,由 `compileCelToFilter` 在转译含字段间比较的 CEL 权限/RLS 规则时产出)此前被 SqlDriver 当作**绑定值**交给驱动,sqlite 抛出无 `code`、无 `status` 的裸 `TypeError` —— 落在 `INVALID_FILTER` 信封之外,到客户端表现为不透明的服务端错误。更隐蔽的是列表位置:`$in` / `$between` 里的 `$field` 成员连报错都没有,直接静默返回零行。

  现在两者都以完整信封拒绝(`error.code = INVALID_FILTER`、HTTP 400、无 `[sql-driver]` 前缀),报错点名字段、运算符与被引用字段,并说明跨字段比较**当前仅内存求值路径(`matchesFilter`)支持**。三个比较发射点统一处理,Filter Protocol 与数组三元组两种写法得到同一答案。

  同一处闸门补上了 issue 指出的通用臂:**已知运算符 + 无法绑定的值形态**(标量比较位上的普通对象 / 数组)此前同样是裸 `TypeError`,现在也返回 `INVALID_FILTER`。`$in` / `$nin` / `$between` 的正常数组绑定不受影响。

  `FieldReferenceSchema` 声明保留,JSDoc 补注执行支持面(内存求值 ✅ / SQL 下推 ❌ 响亮拒绝);SQL 列对列编译实现见 #5222。

- 2ddba89: fix(tenancy): eight sites answered "is this deployment multi-org?" with the demoted `OS_MULTI_ORG_ENABLED` (#5262)

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the authoritative knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — therefore reads `false` from
  `resolveMultiOrgEnabled()` while running a fully mounted organization wall.
  #5233 corrected two sites in `plugin-auth`; a census found eight more, all
  written before that function's doc comment was corrected. Third recurrence of
  the shape (cloud#1020, #5233).

  Each site was judged separately for **which** posture answers its question —
  what the operator REQUESTED, or what the `tenancy` service reports is actually
  IN FORCE — rather than converted mechanically:

  - `objectql` `SchemaRegistry` — the env-derived multi-tenant default. Reads the
    REQUESTED posture (it is constructed below the kernel, with no service
    registry to ask). The `organization_id` column was always provisioned; what
    diverged is its INDEX, so a posture-only deployment ran the Layer 0 wall's
    hottest predicate unindexed while SecurityPlugin compiled that same wall.
  - `plugin-dev` — whether to load the enterprise `@objectstack/organizations`.
    REQUESTED posture, mirroring `serve.ts`: this branch is what mounts the wall,
    so asking whether the wall is up would be circular. A posture-only dev stack
    previously never loaded the package at all and served traffic unwalled. Its
    diagnostic now names the posture that was requested instead of asserting
    `OS_MULTI_ORG_ENABLED=true` at an operator who never set it.
  - `runtime` `AppPlugin` (inline seed + hot-reload seeder) — EFFECTIVE posture,
    via the `tenancy` service. These ask "will the per-org replay run instead of
    me?", and on an ADR-0093 D5 degraded boot that replay does not exist, so
    keying on the request would defer to a replay that can never happen. Walled
    deployments previously inline-seeded exactly the NULL-organization rows the
    code's own comment exists to avoid.
  - `cloud-connection` marketplace local install (install-time seed + rehydrate
    heal) — EFFECTIVE posture, same reasoning. The install path is a write path:
    a walled deployment wrote every sample row with no `organization_id`, landing
    the app's data outside the wall its own reads apply.
  - `driver-sql` `isMultiTenantMode()` — REQUESTED posture (a driver has no
    kernel to ask, and a suppressed warning is the costlier error for a
    diagnostic). It also no longer memoises into `_multiTenantMode`: that froze a
    process-level fact into a per-instance verdict on whichever write landed
    first. The gate now resolves live, which is affordable because
    `auditMissingTenant` consults it only after the `tenantId` early-out.
  - `cli` `os verify` — REQUESTED posture. This one produced a green verification
    run over an unverified property: a posture-only deployment silently skipped
    every multi-tenant proof and exited 0.

  **No configuration change is needed anywhere.** Deployments setting only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  belt-and-braces configuration stays valid. Deployments that set only
  `OS_TENANCY_POSTURE` can now drop the redundant boolean. Single-org behaviour is
  unchanged at every site; only the knob each one reads is corrected.

- 9c5abf4: fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

  Two shapes the Filter Protocol never declared were reaching the drivers, and
  every driver ANSWERED them — with a different answer. Both are now refused with
  `INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
  already speaks.

  ## `$null` with a non-boolean comparand — a behaviour change you can observe

  `FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
  default branches hung on opposite sides, so one filter meant opposite things per
  backend. Measured against one row with `stage: 'won'` (id 1) and one with
  `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

  | backend                                     | read as                           | rows        |
  | ------------------------------------------- | --------------------------------- | ----------- |
  | driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`)    | `["2"]`     |
  | driver-memory query path, driver-mongodb    | IS NOT NULL (anything but `true`) | `["1"]`     |
  | driver-memory reference matcher             | no constraint at all              | `["1","2"]` |

  **What changes for you:** a caller that today gets rows back for
  `{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
  operator, the field and the position. That includes calls working by truthy /
  falsy coincidence — and the sharpest case is the STRING `"false"`, which is
  truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
  the opposite of what its author wrote it to mean, on at least one of them
  whichever they meant. A JSON round-trip or generated metadata produces it
  readily.

  **The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
  `{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
  backends, and so is every other operator. `$exists` is deliberately NOT tightened
  here — it diverges on its own axis (what "exists" means for a null-valued key)
  and is tracked separately.

  ## An undeclared `$op` in a document position — silent empty set becomes a 400

  `FilterConditionSchema` declares exactly three `$`-keys at a node
  (`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
  compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
  `{ $expr: … }` produced a predicate that matched nothing and reported nothing —
  a caller could not tell "no rows matched" from "the filter never compiled". The
  FIELD position had refused the same class of input since v16, so one driver gave
  two answers depending on depth.

  **What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
  returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
  (and `driver-sqlite-wasm`, which inherits it) into line. The three declared
  combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
  and every legal filter compile byte-identically.

  Both refusals are raised on the driver's validating walk rather than in its SQL
  emitter, so a malformed node is refused regardless of whether a sibling
  disjunct would have short-circuited the compile.

- f98fa65: fix(driver-sql): a fresh database no longer boots "drifted", and the drift
  detector never points `--allow-destructive` at an index the framework created
  (#4884)

  Booting `examples/app-showcase` on a brand-new empty SQLite file printed two
  `[schema-drift]` warnings before the server was even ready, both about the
  ADR-0048 overlay indexes the same boot had just created. Both were false, and
  one of them was dangerous:

  > `[schema-drift] sys_metadata: index 'idx_sys_metadata_overlay_draft' UNIQUE
(type, name, organization_id) carries ObjectStack's generated naming but
matches no declared index (orphaned) — "os migrate apply --allow-destructive"
to drop it.`

  `idx_sys_metadata_overlay_draft` is the unique index enforcing **draft-overlay
  uniqueness**. An operator following our own boot advice would have dropped a
  live data-integrity guarantee to fix a problem that did not exist — and, worse,
  learned to treat `--allow-destructive` as routine boot hygiene, which is exactly
  what makes the _next_, real drift warning dangerous.

  Three fixes, in the driver's detector only (no metadata declaration changed —
  `sys-metadata.object.ts` documents its four-column `indexes[]` entry as _the
  fallback shape for drivers without the runtime migration_, and that contract
  still holds for the drivers that rely on it):

  - **The index key is now read as written.** Introspection took the key from each
    dialect's per-column catalogue view (`PRAGMA index_info`, `pg_attribute`,
    `STATISTICS.COLUMN_NAME`), which describes an expression key as a NULL column
    and nothing else. The canonical
    `(type, name, organization_id, COALESCE(package_id,''))` overlay index
    therefore arrived as three columns and was reported as a mismatch against its
    own four-column declaration. SQLite and Postgres now parse the index
    definition (`sqlite_master.sql` / `pg_get_indexdef`), MySQL reads
    `STATISTICS.EXPRESSION` where the server has it, and `COALESCE(col, <literal>)`
    is recognised as keying on `col` — which is what ADR-0048 uses it for: a plain
    UNIQUE index treats NULLs as distinct, so package-less globals would not be
    unique among themselves.
  - **Partial predicates are captured.** A `WHERE`-restricted index is something
    `syncDeclaredIndexes` can neither create nor rebuild, so the detector no
    longer claims authorship of one, no longer calls it orphaned, and never
    proposes a remedy it could not undo.
  - **The driver keeps a ledger of the index DDL it executed.** An index this
    process created through raw `execute()` — how `metadata-protocol`'s
    `ensureOverlayIndex` issues its migration — is the framework's to manage. This
    also covers the plain-index fallback the same migration takes on dialects that
    reject partial indexes.

  Genuine drift is unaffected: an orphaned generated index, a redefined declared
  index and the #3696 legacy-unique replacement are all still detected, still
  categorised exactly as before, and still remediable through `os migrate`.

- 193cd5c: fix(driver-sql): 空 `$and`/`$or`/`$not` 按布尔单位元编译 —— `$or: []` 不再返回全表

  **这是一处查询行为变更,且直接关系到 RLS。** `{ $or: [] }` 以前返回**整张表**,
  现在返回**零行**。如果你的代码依赖了旧行为,它依赖的是一个 filter 旁路。

  `applyFilterCondition` 把每个组合子都编译成一个 knex 分组回调,而 knex 对「一个子句
  都没加进去的分组」不产出任何 SQL。于是「这个组是空的」和「这个组已被满足」编译成了
  同一条查询。**丢弃子句不等于套用单位元**,而两个单位元的方向是相反的:

  | 写法                 | 布尔代数                      | 旧编译    | 错的方向     |
  | -------------------- | ----------------------------- | --------- | ------------ |
  | `{ $and: [] }`       | TRUE → 全部行                 | 全表      | 碰巧正确     |
  | `{ $or: [] }`        | FALSE → **零行**              | 全表      | **静默放松** |
  | `{ $or: [{a}, {}] }` | `{}` 是 TRUE 析取项 → 全部行  | `(a = ?)` | 静默收紧     |
  | `{ $not: {} }`       | `NOT TRUE ≡ FALSE` → **零行** | 全表      | **静默放松** |

  `$and: []` 恰好正确的理由不是代码理解了单位元,而是「丢掉」在 AND 侧碰巧等价于
  TRUE —— 同一段代码在 OR 与 NOT 侧就必然错。放松的那两格是安全相关的:`$or: []`
  最常见的来源正是「本该有条件、但循环一个析取项都没填进去」的 RLS read scope,
  把它当成全表意味着**本该看不到任何行的人拿到了整表**。

  同仓另外两个后端(`formula` 的 `matchesFilterCondition`、`driver-memory`)三条
  本来就都是对的,`driver-sql` 是唯一的例外;现在四个答案统一。

  **配套的形状拒收(否则修复会变得更糟)。** 套用单位元的前提是「编译成空」只剩一个
  成因。在此之前 `$or: [null]`、`$or: ['x']`、`$or: [[…]]`、`$or: [new Date()]`
  同样会无痕消失;不先拦掉它们就上单位元,会把它们从「被静默忽略」**升级成「匹配所有
  行」**,比原 bug 更坏。因此 `$and`/`$or` 的元素与 `$not` 的操作数现在必须是
  **plain object** 的 filter 节点,否则按 ADR-0112 响亮拒收
  (`INVALID_FILTER` / 400,报错指明出错位置,如 `filter.$or[1]`)。原型检查是关键
  的一半:`Date`/`RegExp`/class 实例都满足 `typeof x === 'object'` 却枚举为空,
  若被接受就会被读成 TRUE。同理 `$and: 'x'` 这类非数组操作数也不再被当成一个名为
  `$and` 的字段列。

  判定是**结构性**的(编译前先归约整棵树),而不是「编译完再问 knex 有没有产出」——
  原缺陷本身就是后者那种观察,而观察分不清「因为本来就是空」和「因为有东西没编译
  出来」。结构判定没有这个盲区,并且保证编译器打开的每个分组都至少收到一条子句,
  knex 再没有机会静默丢弃一个组。

  非空的 `$and`/`$or`/`$not` 编译方式完全未变。

- 5aae790: fix(driver-sql): `$not` 改为 NULL-safe —— 被比较列为 NULL 的行不再被否定条件静默排除

  **这是一处可观察的查询行为变更,且直接关系到 RLS 的可见集合。**
  `{ $not: { stage: 'won' } }` 以前**不返回** `stage IS NULL` 的行,现在**返回**它们。
  如果你的规则依赖了旧行为,它依赖的是「同一条规则在不同后端给出不同可见集合」。

  SQL 是三值逻辑:`NULL = 'won'` 是 UNKNOWN,`NOT UNKNOWN` 仍是 UNKNOWN,而 `WHERE`
  只保留 TRUE。于是 `applyFilterCondition` 编译出的裸 `NOT (stage = 'won')` 会把
  「该列没有值」的行整批丢掉;同一条 filter 在 `driver-memory` 与 `formula` 的
  `matchesFilterCondition` 上是普通的两值 JS 求值(`undefined !== 'won'` → 行匹配),
  两边把这些行**都返回**。一个 spec 声明的算子,答案取决于跑它的是哪个驱动。

  这不是「数目对不上」而已:权限规则里的 CEL `!expr` 经 `cel-to-filter.ts` 正是降解成
  `{ $not: {…} }`,所以同一条 read scope 在 SQL 数据源与内存数据源上准入的行集不同。
  #5146 判定以 JS 家族的答案为准(2:1 的多数派;写 `!(stage == 'won')` 的人不会预期
  「stage 为空的行被隐藏」),本次把 SQL 侧对齐过去。

  **编译出来的形状。** `$not` 的操作数在取反之前先被改写成**全域(total)谓词** ——
  永远是 TRUE 或 FALSE,不会是 UNKNOWN:

  ```sql
  -- 之前
  not (`stage` = 'won')
  -- 现在
  not ((`stage` is not null) and (`stage` = 'won'))
  ```

  对 issue 里给出的扁平形状,这与 `NOT (…) OR col IS NULL` 完全等价。把守卫下推到
  **每个叶子**而不是挂在 `NOT` 旁边,是为了在操作数嵌套时仍然正确:`$not` 里套一个
  `$or` 时,顶层的 `OR col IS NULL` 会把 JS 家族排除的行重新放进来(某一列为 NULL、
  但另一个析取分支成立的行)。

  **守卫方向按算子逐个判定,不是一刀切。** `{ $not: { a: { $ne: 5 } } }` 的语义是
  「a 就是 5」,两个 JS 后端都把 NULL 行排除在外;无条件加 `OR a IS NULL` 会把这些行
  交回去 —— 正是本驱动反复付过学费的静默放松(#2704 / #5134)。因此
  `$ne` / `$nin` / `$notContains` 用的是 `col IS NULL OR (…)`,`$eq` / `$in` /
  `$gt` / `$contains` 一族用 `col IS NOT NULL AND (…)`,而 `$null` / `$exists` /
  `$eq: null` / `$ne: null` 本来就是全域谓词,一个字节都不加。

  **只有 `$not` 路径被改写。** 普通比较的 SQL 逐字符不变(`{ a: 1 }` 仍然是
  `a = 1`),因此没有任何非否定谓词因此失去索引;`$not` 路径上的 `IS NOT NULL` 守卫
  本身处在一个原本就不可 sargable 的 `NOT (…)` 里。

  `#5134` / PR #5243 定下的布尔单位元(`{ $not: {} }` → 零行、`$not` of FALSE →
  全部行、非 filter 节点的操作数按 ADR-0112 响亮拒收)全部保持不变;`{ field: {} }`
  (#5240)也刻意不在此裁定 —— 它编译出的 SQL 与之前完全一致。

  `driver-memory` 与 `formula` 无需改动,本次为三家各补了一组 pin 测试,把「值缺失
  行在 `$not` 下的去留」钉在一起。跨驱动 conformance case(`FILTER_LOGIC_CASES`)与
  契约 TSDoc 归 spec 车道,随 #5239 落地。

- 07f1822: fix(driver-sql): `$ne` / `$nin` / `$notContains` 改为 NULL-safe;`$exists` 的非布尔比较值改为拒收

  **这是一处可观察的查询行为变更,且直接关系到 RLS 的可见集合。**
  `{ stage: { $ne: 'won' } }` 以前**不返回** `stage IS NULL` 的行,现在**返回**它们。
  `$nin` 与 `$notContains` 同理。

  ### 变更一:三个否定算子在 `$not` 之外也 NULL-safe(#5298)

  #5146 已经把 `$not` 判定为 NULL-safe(PR #5296),但**只改了 `$not` 内部**;算子自身
  携带否定的三个 —— `$ne` / `$nin` / `$notContains` —— 逐字符未变。于是留下一个使用者
  可见的裂缝:`{ $not: { stage: 'won' } }` 三家一致,`{ stage: { $ne: 'won' } }` 仍然
  分叉。

  成因与 #5146 同源:SQL 是三值逻辑,`NULL <> 'won'` 是 UNKNOWN 而不是 TRUE,`WHERE`
  只保留 TRUE;`driver-memory` 与 `formula` 的 `matchesFilterCondition` 用两值 JS 求值
  (`undefined !== 'won'` 直接为真),把这些行**都返回**。2026-08-06 裁定取「包含无值行」
  方向(与 #5146 同向),本次把 SQL 侧对齐过去。

  ```sql
  -- 之前
  `stage` <> 'won'
  `stage` not in ('won')
  `stage` NOT LIKE '%won%' ESCAPE '\'
  -- 现在
  (`stage` is null or `stage` <> 'won')
  (`stage` is null or `stage` not in ('won'))
  (`stage` is null or `stage` NOT LIKE '%won%' ESCAPE '\')
  ```

  **统一用 OR 展开,不走方言等价物**(`IS DISTINCT FROM` / `IS NOT` / `<=>`),三条理由:
  `NOT LIKE` 根本没有对应形式,走方言就必然要维护两种形状;SQLite 的写法依赖本仓并不
  锁定的引擎版本(sql.js 与 libSQL 各自演进);实测 `EXPLAIN QUERY PLAN` 两种写法计划
  完全相同 —— `<>` / `NOT IN` / `NOT LIKE` 改动前**本来就是全表扫描**,没有索引可失去,
  也没有索引可赢回。

  **正向比较一个字节都没动。** `{ a: 1 }` 仍然是 `a = 1`,`$in` 仍然是 `in (…)`,
  `$gt` / `$contains` 一族同理,所以绝大多数普通查询的 SQL 形状不变。
  `$ne: null` 也不变 —— 它是空值**谓词**(`IS NOT NULL`)而不是比较,「有任何值」对
  一个没有值的行本来就是假。

  **`$not` 路径不受影响。** `nullSafeNegationOperand` 的逐叶守卫按原样保留:它必须能在
  操作数任意嵌套时通过 De Morgan 组合,这与叶子发射器自身是否全域是两个独立的正确性
  来源,把它们耦合起来会让其中一个的回退静默破坏另一个。

  ### 变更二:`$exists` 的非布尔比较值改为拒收(#5369,套用 #5347 裁定 A)

  `FieldOperatorsSchema` 声明 `$exists: z.boolean()`,而从 `where` 到驱动之间没有任何
  环节按它校验,所以非布尔值真的会到达发射器。到达之后各后端分叉方向相反:本驱动的
  `opValue === false` 恒等判断把「除 false 以外的一切」读成 `IS NOT NULL`,`=== true`
  的写法则把「除 true 以外的一切」读成 `IS NULL`。注意字符串 `"false"` 是**真值**,
  所以它落在与作者本意**相反**的一侧 —— JSON 往返或 AI 生成的 scope 很容易产出它。

  现在与 `$null` 的闸门并排,在 `reduceFilterKey` 的校验遍历里拒收,`INVALID_FILTER` /
  400,信封与措辞同款。`{ $exists: true }` / `{ $exists: false }` 行为一字未变。

  **发射器与极性表刻意不动。** 闸门落地后只有两个布尔值能到达它们,`opValue === false`
  与 `value === false` 已经是穷尽的二选一。#5369 正文建议的「收紧为 `value === true`」
  方向写反了:极性表回答的是「NULL 列是否**满足**该算子」,而 NULL 列恰恰在调用方要求
  `$exists: false` 时满足它 —— `$null: true` 与 `$exists: false` 是同一个问题,两条
  分支正确地互为镜像,而不是互为副本。

  ### 相关

  `driver-memory` / `driver-mongodb` 的对应半边按 #5499 冻结,本次零改动、既有一致性
  断言全绿;`driver-turso` 的 remote transport 是独立编译器,归 #5903;
  `service-analytics` 的 `filter-normalizer`(Cube 面)归本裁决第二批。

- acf34e3: fix(drivers): refuse an `undefined` filter comparand instead of crashing (SQL) or silently answering `IS NULL` (Turso remote) (#6050)

  **⚠️ 行为变更(升级说明在最后一节)。** 比较数位置上的 `undefined` 从「静默/崩溃」变为 `INVALID_FILTER` / 400 拒收。作者侧的修法是显式判空,或改用 `null` / `$null`。

  ## 实测到的毛病

  同一个 `TursoDriver`,同一条过滤器,答案取决于它是用哪个 `url` 构造的 —— 四行 fixture(`d` 在 1-2 有值、3-4 为 NULL),`origin/main` @ `cba7454df`:

  | filter                                | LOCAL(继承 `SqlDriver`)          | REMOTE(`RemoteTransport`) |
  | ------------------------------------- | -------------------------------- | ------------------------- |
  | `{ d: undefined }`                    | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ d: { $eq: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ $not: { d: undefined } }`          | 抛裸 knex `Undefined binding(s)` | `['1','2']`               |
  | `{ d: { $ne: undefined } }`           | `['1','2']`                      | `['1','2']`               |
  | `{ $not: { d: { $ne: undefined } } }` | `[]`                             | `['3','4']`               |
  | `{ d: { $in: [undefined] } }`         | 抛裸 knex `Undefined binding(s)` | `[]`                      |
  | `{ d: { $gt: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `[]`                      |

  两个可分开的毛病:

  **A —— 抛出的那几格没有 ADR-0112 信封。** knex 的 `Undefined binding(s) detected when compiling SELECT` 既没有 `code` 也没有 `status`,`mapDataError` 落默认分支,于是一条「调用方把 filter 写坏了」的错误以不透明 500 的形态到达客户端。#1116 / #4436 为这条通路清点过同类形态,唯独漏了这一格。

  **B —— 守卫与它自己的发射器分裂。** `$ne` 发射器读 `coerced == null`(宽松,所以 `undefined` 编译成 `IS NOT NULL` —— 一条 TOTAL 谓词),而必须钉住这个发射器的两张极性表 `operatorIsNullTotal` / `nullValueSatisfiesOperator` 读 `=== null`(严格,于是判它「不 total」且「NULL 行满足它」)。`nullGuardForFieldSpec` 因此把一条已经 total 的谓词包成 `d IS NULL OR d IS NOT NULL` —— 恒真 —— 取反后恒假,答 `[]`。这正是 #5298 立的不变量(每张极性表钉的是它自己发射器的拼写)在它自己的定义处被破坏。

  ## 修法

  一道闸,落在比较数进入**任何**发射器或守卫之前,两个毛病同闸消灭:knex 再也见不到 undefined 绑定,守卫与发射器对 undefined 的分歧变成**不可达**而不是「被修好」。

  - `driver-sql`:闸落在 `reduceFilterKey` 的校验走查上(与 `$null` / `$exists` 的拒收并排),外加 `applyFilters` 的平铺映射分支 —— `{ d: undefined }` 进不了走查(`typeof undefined` 不是 `'object'`,构不成 `hasMongoOperators`),而它恰恰是这个 bug 最常见的拼写。两处共用一个函数。
  - `driver-turso`:`buildWhereSQL` 入口做一次整棵子树的前置走查。必须前置,否则 `{ $not: { d: undefined } }` 会先把操作数交给 `nullSafeNegationOperand`(一个守卫)。
  - 顺带把两侧的 `== null` / `|| === undefined` 拼写统一收严成 `=== null`(#5347 收紧 `$null` 臂时给的理由:宽松拼写在闸被挪走后会悄悄恢复回答一个没人裁决过的取值)。

  拒收的位置逐个清点:直接比较数、单值算子的比较数(`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族)、列表算子数组的**成员**(`$in`/`$nin`/`$between`)、以及嵌在 `$and`/`$or`/`$not` 里的以上各位。`$null` / `$exists` 的 `undefined` 保持它们**自己**的拒收措辞(比较数是声明的布尔量,那条消息更贴切 —— #5240「一个条件一种措辞」两个方向都适用)。两个驱动的拒收句子逐字一致。

  ## ⛔ `null` 一字未动

  `{ f: null }`、`{ $eq: null }` → `IS NULL`;`{ $ne: null }` → `IS NOT NULL`;`$null: true/false` 不变;`null` 仍是合法的 `$in` 成员。`null` 是声明过的比较数,拒的只是 JS 里与「没有这个键」不可区分的那个值。

  ## 升级说明

  如果你的进程内代码这样拼过 filter:

  ```ts
  // 之前:id 缺失时 —— 本地崩、远端静默匹配全环境行
  await ql.find("deal", { where: { owner_id: ctx.user?.id } });
  ```

  现在会收到 `INVALID_FILTER` / 400,消息里带修法。两种正确写法:

  ```ts
  // 1) 显式判空 —— 键不存在就是「不约束」
  const where: Record<string, unknown> = {};
  if (ctx.user?.id !== undefined) where.owner_id = ctx.user.id;

  // 2) 真的想要空值谓词 —— 写出来
  await ql.find("deal", { where: { owner_id: null } }); // 或
  await ql.find("deal", { where: { owner_id: { $null: true } } });
  ```

  `where` 整体缺席仍然是「没有过滤器」(`query?.where` 为 `undefined` 是它唯一合法的位置),不受影响。

  ⚠️ 本次只覆盖 `driver-sql` 与 `driver-turso`(含 remote)。`driver-memory` / `driver-mongodb` 是 #5499 的投入冻结面,按裁决只测不改;`@objectstack/formula` 与 `service-analytics` 的 `read-scope-sql.ts` 对同一形状各有一种不同读法,实测记录在 #6125,留待单独裁决。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/observability@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- c6d1cb4: refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

  `findStream` was a **required** method on the driver contract — every driver and
  every test double had to implement it — documented as the read

  > Optimized for large datasets to avoid memory overflow.

  Three things were true about it at once, and each is worse in the light of the
  others.

  **Nothing called it.** Not the query engine (there is no `stream` entry on it),
  not REST export, not import, not any bulk-read path. Repo-wide, outside the
  contract declaration and the three driver implementations, every single hit was
  a test double — and roughly twenty of those satisfied the required method like
  this:

  ```ts
  findStream() { throw new Error('not implemented'); }
  ```

  Twenty stubs that throw, across four packages, for years, and no test ever went
  red. That is not an anecdote about test hygiene; it is the proof of absence. A
  method whose every double throws is a method nothing reaches.

  **Two of the three implementations inverted its one guarantee.** `SqlDriver` and
  `InMemoryDriver` both did this:

  ```ts
  const results = await this.find(object, query, options); // ← the entire result set
  for (const row of results) yield row;
  ```

  The whole table is resident in memory before the first `yield`. A caller who
  believed the doc comment and reached for `findStream` precisely because a result
  set was too large would have hit the overflow it existed to prevent, at exactly
  the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
  admitting it.

  **The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
  did walk a cursor — but it was the only read in that driver never routed through
  `buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
  discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
  and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
  that divergence rather than fixing it — there is nothing left to fix it for.)

  Rather than manufacture a caller to justify three implementations, the method is
  retired. If a cursor-based read is wanted, it should arrive **with** the caller
  that needs it, so the contract can be shaped by a real requirement instead of
  being reverse-engineered from a doc comment nobody could test.

  **Migration.**

  | Wrote                                                      | Write instead                                              |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
  | `findStream(…) { … }` on your own driver                   | delete the method (see below)                              |
  | `findStream() { throw new Error('ni'); }` in a test double | delete the line                                            |

  Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
  and memory it is strictly better (bounded pages instead of one full
  materialisation), and the paged read is the one with an **enforced** guarantee —
  `IDataDriver.find` requires a total order across the whole walk, checked by the
  shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
  `data/pagination-conformance.ts`. `findStream` never had a conformance case at
  all.

  **Driver authors: nothing breaks on you.** An implementation left in place still
  compiles — an extra method is not an error on a class or a widened object — it is
  simply never reached, so deleting it is cleanup you can do whenever. The break is
  on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
  were no callers.

  **No tombstone, deliberately.** The other v17 retirements tombstone their key so
  authoring it fails loudly with a prescription. That would be noise here.
  `DriverInterfaceSchema` describes a contract that code _implements_; nothing in
  either repository ever ran a driver object through `.parse()`, so a
  `retiredKey()` there would carry its prescription to no one. The channel that can
  carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
  The key is removed from the schema and from `IDataDriver`, and the retirement is
  registered as the `data-driver-find-stream-retired` semantic entry in the
  protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool all carry it. There is no
  `os migrate meta` step: a driver is code, never stack metadata, so the chain has
  no source to rewrite.

  **Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
  whose only referent was this method. It has no readers either (and the values
  written into it were already wrong — `SqlDriver` declared `streaming: false`
  while implementing `findStream`, `InMemoryDriver` declared `true` for the
  copy-everything version), but removing a key from the capabilities literal breaks
  every driver that writes it, third-party included, and the same audit should
  cover the other ~30 flags in one pass rather than one at a time. Tracked as
  #4634.

- d9fa683: refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

  The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
  described a contract method that no longer exists — and a full liveness audit of
  the record (#4634, across objectstack + cloud, objectui confirmed clean) found
  `streaming` was not the exception but the rule. Of 34 declared bits, **three**
  have a decision-making reader and **thirty-one** were written by every driver
  and consulted by no engine, planner, REST layer or renderer:

  - Their `.describe()` strings promised engine adaptation that was never built
    ("If false, ObjectQL will fetch all records and filter in memory" — no such
    fallback ever keyed off the bit).
  - Zero readers let values go WRONG unnoticed: `SqlDriver` declared
    `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
    `streaming: true` over a full-table read — the exact inverse of the guarantee.
  - The real mechanism everywhere else is **method presence**: transactions gate
    on `driver.beginTransaction`, aggregate pushdown on
    `typeof driver.aggregate === 'function'`, schema sync on
    `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
    are called unconditionally.

  Survivors (each with a named reader — the bits method presence cannot carry):

  | bit                    | reader                                                                                   |
  | ---------------------- | ---------------------------------------------------------------------------------------- |
  | `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
  | `autonumber`           | engine defers autonumber generation to the driver (`engine.ts`)                          |
  | `batchSchemaSync`      | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`)              |

  Migration (FROM → TO):

  - Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
    `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
    `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
    `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
    `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
    `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
    `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
    literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
    tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
    error against `IDataDriver.supports` and a parse error carrying the per-key
    prescription, which names the mechanism that actually decides the behaviour.
  - `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
    already meant `false` at both readers, so `supports: {}` is now a valid,
    minimal advertisement. If you read `capabilities.batchSchemaSync` from a
    _parsed_ config and relied on the materialised `false`, treat absence as
    `false` (both engine readers always did).
  - Driver packages: `InMemoryDriver.supports` is now `{}`,
    `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
    is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
    Reading a removed bit off these literals no longer type-checks — and no code
    in any repository did.
  - A future capability (streaming reads, vector search, …) returns **with its
    caller and its reader in the same change** — the enforce route of ADR-0049 —
    never as a dangling boolean.

  The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
  (parse + `tsc` both audible; the schema IS parsed via
  `DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
  semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
  never stack metadata — `supports` lives in driver classes and `DriverConfig`
  is plugin TS configuration, so there is no stored row or stack source for a D2
  conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
  retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
  lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
  asserting every retired bit is unwritable (`undefined`) and every live bit is
  not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
  resurrection).

  No runtime behaviour changes — that impossibility is the point: every removed
  bit had zero readers, and the three live bits keep theirs.

### Minor Changes

- ea90179: fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

  Four independent surfaces where the answer a caller received contradicted the
  contract the surface declares. All four were found driving a real showcase boot
  against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

  - **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
    refusing to run untrusted code that asked for a capability it does not hold,
    which is the crash contract's case (#3951), not a deliberate rejection of a
    malformed request. It now answers 500, and the `SandboxError:` debug prefix
    no longer reaches the client.

  - **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
    write path returned `record: null` / `success: true` for an id that resolves
    to nothing, while GET on the same id correctly 404s; `deleteMany` reported
    every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
    can no longer read a successful envelope as proof the write landed.

  - **#4436 — the unsupported-filter-operator refusal shipped without
    `error.code`.** A refusal with no code is unmatchable by a client, and the
    message leaked the internal `[sql-driver]` prefix. It now speaks
    `INVALID_FILTER` without the driver prefix.

  - **#4483 — the `$search` auto field set admitted its lead field
    unconditionally.** `nameField`/`name`/`title` were prepended without passing
    `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
    The lead field now only ORDERS the set it is already a member of; it can no
    longer admit one.

  These change responses that were observably wrong, so callers coded against the
  buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
  see different status codes. Graded `minor` on that basis rather than `patch`.

### Patch Changes

- a52e2ef: fix(driver-sql,spec,objectql): a `defaultValue` runtime token never becomes a column DEFAULT (#4560)

  `Field.user({ defaultValue: 'current_user' })` is resolved by the **engine**, at
  insert time, from the request's `ExecutionContext` — and with no authenticated
  user (system / anonymous writes: seed replay, package install, boot
  provisioning) `applyFieldDefaults` deliberately leaves the field **unset**
  rather than stamp a bogus owner.

  The SQL DDL had never heard of the token. `createColumn` passed any non-object
  `defaultValue` straight through to `col.defaultTo(dv)`, so the column was
  created as `DEFAULT 'current_user'` and the **database** overrode the engine's
  decision: every insert that omitted the field stored the literal string
  `current_user` in a `lookup('sys_user')` column — a value that is not any user's
  id. `?expand` resolves it to nothing, and on an owner / approver field it is a
  silent mis-attribution. Found by #4551's dangling-reference audit on its first
  run against a real boot; #4441's referential check could never have caught it,
  because it inspects the values a **caller** supplied and here nobody supplied
  one.

  **The token vocabulary is now declared once, in `@objectstack/spec/data`**
  (`DEFAULT_VALUE_TOKENS`, `isRuntimeDefaultToken`, `isNowDefaultToken`,
  `isCurrentUserDefaultToken`, `isAppResolvedDefaultToken`). The engine's
  insert-time resolution and the driver's DDL read the same set, which is the
  actual defect: `'NOW()'` was special-cased in the branch immediately above for
  precisely this reason, and `current_user` — the same convention family — simply
  had no entry anywhere the DDL could see. A token added to the set tomorrow is
  excluded from literal column DEFAULTs automatically, rather than leaking its own
  spelling into the database the way this one did.

  **DDL, in one place** (`applyDeclaredColumnDefault`, shared by column creation
  and the SQLite table rebuild):

  - `'NOW()'` → the driver-native canonical default, exactly as before;
  - any other runtime token → **no column default at all** (the engine owns it);
  - Expression envelopes (`{ dialect, source }`) → unchanged, no default;
  - a real literal → emitted verbatim, unchanged.

  **Existing databases carry the wrong DEFAULT**, so it is corrected through the
  managed schema-drift path (#2186) rather than a bespoke migration: a new
  `default_mismatch` finding with a `drop_column_default` op, categorised `safe`
  (the statement cannot fail and touches no rows). Dev boots with
  `autoMigrate: 'safe'` reconcile it automatically; everywhere else it is reported
  with an actionable hint and applied by `os migrate apply`. Postgres/MySQL use
  `ALTER COLUMN … DROP DEFAULT`; SQLite, which cannot alter a default in place,
  goes through the existing table rebuild — which now re-materialises every
  column's default from **metadata**, so a sibling `defaultValue: 'NOW()'` column
  keeps the default it always had instead of losing it to the rebuild.

  **Rows already holding the bogus value are NOT rewritten.** That is #4551's
  standing rule — report, never rewrite — so they stay visible to the
  dangling-reference audit for operators to resolve deliberately.

- ec975f1: fix(objectql,driver-mongodb)!: `findOne` must say which record it wants, and executes every option it declares (#4419)

  `findOne` reads a single row, which makes its predicate the only thing between
  the caller and _an arbitrary record_. When the predicate is missing the result is
  not `null` — it is the object's **first row**: a real, plausible-looking record
  with nothing to do with the request, which the `if (!row)` check every call site
  already has cannot catch, and which then propagates into whatever is computed
  next. Reported downstream: line items defaulting their price from the first
  product in the catalog rather than the selected one, and "is this deal already
  closed?" answered against an unrelated record while the write that followed
  correctly targeted the intended id. A throw would have been caught in
  development; a `null` would have been caught by the null-check. A valid-looking
  wrong record defeats both.

  **Breaking — `findOne` now refuses a query that selects nothing in particular.**

  FROM → TO:

  | Was                                                         | Now write                                                           | Meaning                                          |
  | ----------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
  | `findOne(o)`, `findOne(o, {})`, `findOne(o, { where: {} })` | `findOne(o, { where: … })`                                          | the record matching this predicate               |
  |                                                             | `findOne(o, { search: 'Acme' })`                                    | the record this search finds                     |
  |                                                             | `findOne(o, { orderBy: [{ field: 'created_at', order: 'desc' }] })` | the FIRST record in this order — the newest      |
  |                                                             | `find(o, { limit: 1 })`                                             | any row will genuinely do, said at the call site |

  One-line fix: add the `where` you meant, or `orderBy` if you meant "the newest
  one", or switch to `find(o, { limit: 1 })` if any row will do. The error names
  all four. `find` and `count` are unchanged — returning or counting every row is
  an honest answer; only `findOne`'s implicit "just one of them" turns a missing
  predicate into a confidently wrong record. The guard reads the CALLER's
  predicate, before RLS/sharing middleware injects its own: a tenant filter
  narrows which rows are visible, it does not make "whichever comes first"
  something the caller asked for.

  **Two silent drops that produced the same wrong record are fixed with it.**

  - **`findOne({ search })` applies the search.** The ADR-0061 `search` →
    cross-field `$contains` expansion lived inline in `find` and nowhere else,
    while `find` and `findOne` are checked against the SAME legal-key set — so
    `search` passed the gate, rode onto the AST, and reached a driver. No driver
    reads `ast.search`. The read therefore ran with no predicate at all and
    `limit: 1` did the rest. The expansion is now one method both call.
  - **`MongoDBDriver.findOne` applies `orderBy`, `fields` and `offset`.** It
    translated `query.where` and dropped the rest, so `findOne({ orderBy })` did
    not return the newest record — it returned whichever document the scan reached
    first. `find` and `_findStream` in the same driver had always handled all
    three. This one matters beyond Mongo: the guard above tells an unpredicated
    caller to reach for `orderBy`, and an escape hatch one backend ignores is not
    an escape hatch. No ordering is IMPOSED when the caller supplies none — both
    drivers keep that carve-out (#4363), and `SqlDriver`'s comment about Mongo
    "never sorting" is corrected, since it cited the dropped parameter as
    agreement.

  **And a gate so the class does not come back.** A drift pin walks
  `ENGINE_OPTION_KEY_SETS.findOne` and requires each declared key to have an
  observable effect — on the AST the driver receives, on the driver options, or in
  an explicit "not executed, and here is why" entry (only `limit`, which the
  contract's `limit: 1` overrides). `search` sat declared-but-unexecuted through
  two rounds of hardening because nothing asked that question.

  Together with #4346 (`filter` → `where` folds on every entry point) and #4400
  (unknown option keys throw), a read parameter the engine does not execute now
  fails at the call site instead of quietly changing the answer.

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [ff17642]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/observability@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- 2d3e255: feat!: ADR-0113 — `required` is a write contract; the column constraint becomes the explicit `storage.notNull`

  `field.required` bound three meanings to one knob (write check, `NOT NULL` DDL,
  drift expectation), so tightening any invariant on a deployed object was a
  destructive migration blocked by the very legacy nulls that motivated it — the
  reason `criteria_json`'s mandatory-in-substance contract lived in three
  imperative guards instead of one declaration.

  Split, with the **non-regression invariant** as the unifying rule — _a write
  may not take a record from compliant to violating; a pre-existing violation
  does not block writes that leave it in place_:

  - `required: true` = the write contract, uniformly on new and deployed objects:
    insert must provide; **an update PATCHing `null` into a required field is now
    rejected** (it silently passed before); omitted fields never block, so legacy
    null rows rest. The column stays nullable.
  - `storage: { notNull: true }` = the explicit physical constraint, owning the
    DDL (`sql-driver` `createColumn`) and the destructive drift ceremony.
    Orthogonal to `required` — all four combinations are legitimate, including
    the engine-populated column (`storage.notNull` without `required`).
  - `requiredWhen` inherits the same invariant: flipping the condition true
    without providing the field is rejected (the write _creates_ the violation);
    a row violating since before the rule tightened no longer locks out
    unrelated edits (#3929's objection, cured). `storage.notNull` ×
    `requiredWhen` rejects at parse (`FieldSchema.superRefine`).
  - **Pre-17 sources keep their exact meaning** via the migration-chain-only
    `field-required-notnull-explicit` conversion: `os migrate meta` stamps
    `storage.notNull` onto every previously-required field — writing down what
    the old text already meant. The loader never infers semantics from the
    physical column.
  - Drift compares nullability against `storage.notNull`; a column stricter than
    its declaration is `needs_confirm` (never auto-applied — dev auto-reconcile
    no longer silently strips a stray `NOT NULL`), and silent when the field is
    write-gated by `required`.

### Minor Changes

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- c8124e5: fix(driver-sql): give `Field.datetime` one UTC storage form per dialect (#3912, #3942)

  Any window filter on a `Field.datetime` column returned an empty set on SQLite —
  a dashboard `dateRange: last_30_days` on `created_date` read 0 while 29 matching
  rows existed.

  There was never a storage _convention_, only a description of what better-sqlite3
  happened to do with a bound JS `Date`. Nothing enforced it — `formatInput`
  deliberately left `datetime` untouched — so the form was decided by whichever
  writer got there first: a JS `Date` landed as INTEGER epoch ms, while a REST/JSON
  write (JSON has no `Date` type), a `defaultValue: 'NOW()'` slot, and the
  platform's own `created_at` / `updated_at` all landed as ISO **TEXT**. One column
  held both forms while the read path coerced comparands to epoch ms purely from
  the _declared_ type. On SQLite's type ordering (`INTEGER < TEXT`) a two-sided
  window collapsed to zero rows, and a one-sided `>=` matched every TEXT row
  regardless of the bound.

  `Field.datetime` now has one canonical instant per dialect, produced by one
  function applied on write **and** to every filter comparand, so the two sides of
  a comparison cannot disagree about shape:

  - **SQLite** — `YYYY-MM-DDTHH:MM:SS.sssZ` text. Lexicographic order _is_
    chronological order, so range filters and `ORDER BY` read the column directly
    and can use an index; `strftime` parses it, so the date-bucket expression needs
    no CASE.
  - **Postgres** — `timestamptz`, unchanged. The fix here is on the write and
    comparand side: a zone-naive write was previously resolved against the
    _server's_ timezone (measured 8 hours off on `Asia/Shanghai`), and an
    un-anchored `YYYY-MM-DD` comparand meant the server's local midnight, so the
    identical query over the identical instant landed a row on a different calendar
    day than SQLite did.
  - **MySQL** — `DATETIME(3)` instead of `TIMESTAMP`, a connection pinned to UTC on
    both the mysql2 and the server layer, and a MySQL-spelled bind carrying the
    same UTC wall clock. MySQL accepts neither the `T` separator nor the `Z` suffix
    in a datetime literal, so datetime writes over REST had always failed outright;
    `TIMESTAMP` additionally truncated milliseconds and could not store an instant
    outside 1970..2038.

  Existing rows converge at schema sync. Both migrations are allowed to fail: they
  log, mark nothing, and the read paths keep a repair expression, so an un-migrated
  column still compares and buckets **correctly** — just unindexed. Neither can
  repair instants the old timezone-ambiguous write path recorded wrongly; they
  preserve what is on disk.

  Also closes #3928 (datetime `ORDER BY` mis-sorted on mixed storage) by
  construction. Rationale is recorded as ADR-0053 addendum D-B1..D-B4.

  The analytics change is additive: a `coerceTemporalFilterColumn` companion to the
  existing `coerceTemporalFilterValue` hook, so a raw-SQL strategy can normalise the
  column side too. Absent hook → byte-identical SQL.

- 9774b78: fix(driver-sql): `Field.time` gets a canonical storage form — `HH:MM:SS[.fff]` wall-clock text on every dialect (#3994)

  `Field.time` repeated the pre-#3912 `Field.datetime` pattern: writes were never
  normalised and only reads were repaired, so one SQLite column accumulated bare
  time-of-day TEXT, full-timestamp TEXT and INTEGER epoch ms side by side.
  `find()` looked right; everything that compared the STORED form was wrong —
  measured: a business-hours window filter silently dropped 4 of 7 rows, ORDER BY
  sorted 14:30 before 08:00, a full-ISO write failed the statement outright on
  both Postgres and MySQL, a bound `Date` stored a process-timezone wall clock on
  pg, MySQL's bare `TIME` rounded `…00.500` up to `…01`, and a `NOW()` default
  resolved against three different clocks on the three dialects.

  The #3912→#3942→#3954 construction, transplanted (ADR-0053 D-C1..D-C3):

  - One `canonicalTimeOfDay` — `HH:MM:SS`, `.fff` only when non-zero; `Date`/
    epoch/full-timestamp fold to the UTC time-of-day — applied on write
    (`formatInput`), to filter comparands (`coerceFilterValue`, and thereby the
    `temporalFilterValue` contract hook) and on read (`toTimeOnly`).
  - SQLite: legacy columns converge at schema sync (`backfillCanonicalTimes`,
    same `IS NOT`-guarded UPDATE, same log-and-swallow policy); until then the
    filter paths wrap the column in the repair expression — correct, just
    unindexed. `os migrate plan` lists the work as `normalize_time_storage` with
    a row count.
  - MySQL: new time columns are `TIME(3)`; legacy `TIME(0)` columns widen at
    schema sync (`migrateMysqlTimeColumns`, plan kind `widen_time_columns`),
    since zero-precision TIME _rounds_ fractional writes.
  - `NOW()` defaults read the UTC clock on every dialect (Postgres previously
    used the server zone, MySQL the inserting session's zone — and MySQL 8.0
    rejects a plain `CURRENT_TIMESTAMP` default on TIME entirely).
  - `distinct()`/`aggregate()` present time columns exactly as `find()` does.

  `HH:MM:SS` writes round-trip byte-identically (the field-zoo `f_time`
  contract); a minutes-only `HH:MM` now completes to `HH:MM:00`, and uninterpretable
  values still pass through untouched.

- 33a5ff4: `os migrate` no longer touches the database before you confirm, and refuses a
  SQLite database another process is using (#3917).

  **Nothing is written before the prompt.** `plan` called itself a dry run and
  `apply` gated on `[y/N]`, but both booted the full plugin set first — and boot
  schema-sync issued create-table/add-column DDL (plus the artifact's inline seed
  wrote rows) against the target database before either promise was kept.
  `SqlDriver` gains `setDeferredDdl` / `previewDeferredSchemaWork` /
  `flushDeferredSchemaDdl`: while armed, `initObjects` still registers every
  in-memory map drift detection depends on but records the physical work instead
  of performing it. Both commands boot with it armed, render the held-back work
  as a `New (additive)` section of the plan, and `apply` performs it only after
  confirmation. `os meta resync` / `os migrate files-to-references` keep the old
  behaviour — they need the tables to exist.

  **Occupancy check.** A live `os dev`/`os serve` holding the same SQLite file is
  the usual way a migration goes wrong: the migration is transactional and swaps
  tables inside the file, but the running server keeps prepared statements and a
  schema cookie the migration invalidates. `os migrate` now probes the target
  before booting — `PRAGMA locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` under
  `busy_timeout = 0`, which reports `SQLITE_BUSY` when another connection is
  _attached_, not merely writing. (`wal_checkpoint(TRUNCATE)` only sees an active
  writer, and `-wal`/`-shm` presence cannot tell a live server from a crashed one;
  both are encoded as tests.) `apply` refuses with exit 1 — `error: database_busy`
  under `--json` — unless the new `--force` flag is passed; `plan` warns and
  continues, since it writes nothing either way. SQLite only: Postgres and MySQL
  take their own server-side locks.

  `@objectstack/runtime` also exports `resolveStandaloneDatabase()`, so a caller
  can resolve the database target with the same precedence the boot uses without
  building the stack, and `createStandaloneStack` accepts `skipSeedData`.

- 9e01213: fix(cli,driver-sql): `os migrate plan` lists the datetime storage convergence (#3954)

  The datetime canonicalisation (#3912/#3942) added two steps to `initObjects`'
  physical path: a row-rewriting backfill on SQLite and a `TIMESTAMP` →
  `DATETIME(3)` column rebuild on MySQL. Both already respected the DDL deferral,
  so `plan` performed neither and `apply` performed both — the behaviour was never
  wrong. The reporting was.

  `PendingSchemaWork` could only express `create_table` / `add_columns`, so an
  operator saw a plan listing two added columns, confirmed it, and `apply`
  additionally rewrote every row of a datetime column — or took a metadata lock to
  rebuild one on a large table. The plan promises to show what apply will do.

  - `PendingSchemaWork.kind` gains `normalize_datetime_storage` and
    `widen_datetime_columns`, plus an optional `rows` carrying how much data the
    step touches: row-writes for the backfill, the table's size for the rebuild —
    the number that decides "now" versus "in a maintenance window".
  - `previewDeferredSchemaWork()` measures both without performing either, reusing
    the exact predicate each migration uses (the backfill's whole `WHERE`, the
    widening's own `information_schema` filter) so the plan and the apply cannot
    name different sets. A probe that cannot run is swallowed to "unlisted", never
    to a failed plan.
  - The CLI renders them under their own heading rather than folding them into the
    additive section, whose "created when you apply" framing carries an implicit
    promise that the work is never data-losing. `summarizePendingSchemaWork` — the
    line read just before typing `y` — never omits in-place work.

- c53aa53: File-backed SQLite now runs `journal_mode = WAL` (#3941).

  `SqlDriver.connect()` set `auto_vacuum` and left the journal mode alone, so
  every ObjectStack SQLite database ran SQLite's built-in default — a rollback
  journal. That is the worst mode for the shape this platform actually has, which
  is **several processes on one file**: a dev server, `os migrate`,
  `os meta resync`, a test run. Measured, on the same file:

  |                                                | rollback journal                                   | WAL                                                               |
  | :--------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------- |
  | writer while another process holds a read open | `SQLITE_BUSY` — committing needs an exclusive lock | proceeds                                                          |
  | idle attached connection visible to SQL        | no — a lock lasts only as long as its transaction  | yes (`locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` reports busy) |

  The second row is why the `os migrate` occupancy check had to inspect file
  descriptors to see a live server at all (#3940): under a rollback journal there
  was nothing in the database to see. That signal stays — it names the process,
  which WAL's lock probe cannot — but the SQL probe is now authoritative for
  databases ObjectStack created rather than a fallback that was blind in practice.
  Concurrent _writers_ still serialize; SQLite allows one at a time in any mode.

  Journal mode is a persistent property of the file, so an existing database is
  converted in place on the next connect (a header change — no rows are touched)
  and stays converted. Two consequences to plan for:

  - `app.db-wal` / `app.db-shm` exist beside the database while a connection is
    attached, and `app.db-wal` can hold committed transactions. A clean shutdown
    checkpoints them away; a naive copy of `app.db` alone while a server runs does
    not. Use `sqlite3 app.db ".backup …"`.
  - **WAL does not work on network filesystems** (NFS/SMB). Opt out with
    `OS_DATABASE_SQLITE_JOURNAL_MODE=delete`, or per datasource with
    `sqliteJournalMode: 'delete'` in the driver config (which outranks the env
    var). Either form _applies_ `delete`, so it also converts a database that
    already adopted WAL back — skipping would have stranded it.

  Nothing here fails a boot, and nothing is assumed: `PRAGMA journal_mode = X`
  answers with the mode actually in force rather than raising on refusal, so the
  reply is read back; and because a filesystem can accept WAL and then fail the
  first read _through_ it, the mode is proven with a read and rolled back to
  `delete` if that fails — with a warning naming the file and the escape hatch.
  `synchronous` is untouched, so durability is exactly what it was. `:memory:`
  databases are left alone, as is `auto_vacuum = INCREMENTAL`, which keeps
  reclaiming under WAL (ADR-0057).

  `os db clean` now counts `-wal` / `-shm` as part of the database when it measures
  what a `VACUUM` reclaimed, so bytes that were sitting in the log do not read as a
  reclaim of zero.

  `@objectstack/driver-sqlite-wasm` deliberately stays out of WAL. Its live
  database is in the WASM heap and what reaches disk is a byte image it exports, so
  nothing reads the database across processes and the pragma buys it nothing —
  while still being a persistent header change in the operator's file. sql.js
  _accepts_ the pragma (its VFS is memory-backed), so this had to be declared
  rather than discovered.

  It also now parks a `-wal` left behind by an unclean native-driver exit rather
  than loading the image beside it: wasm SQLite cannot read that log, and leaving
  it next to a freshly rewritten image would let a later real SQLite replay frames
  that no longer belong to it. The warning names the file it parked and how to
  recover what was in it.

### Patch Changes

- 0af50a3: fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

  A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
  lower bound and was silently wrong for an upper one: the dashboard date-range
  filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
  `datetime` column every row created after 00:00 of the `to` day vanished from
  the result — no error, the chart renders, the numbers are just smaller. The
  default configuration hit it: the filter's default field is `created_at`
  (a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

  The translation is operator-sensitive and half-open, applied at every
  comparison emitter:

  - `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
    bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
    in the column's storage form; `$between [min, max]` with a bare-day max
    decomposes to `>= min AND < next-day(max)`. Both the plain and the
    legacy-repair (mixed-storage) column paths, both `where` spellings.
  - `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
    instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
  - The `/analytics/sql` rendering and the dataset preview evaluator apply the
    same rule, so the echoed SQL and drafted numbers reproduce execution.

  `@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
  the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
  `Date`s and impossible days are never widened).

  Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
  (`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
  (instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
  those). No authored metadata changes: a dashboard's existing
  `{ $gte, $lte }` window now simply includes its final day.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 42e3b01: fix(driver-sql): `Field.date` + `defaultValue: 'NOW()'` records the UTC calendar day on Postgres/MySQL (#4022)

  The bare `CURRENT_TIMESTAMP` default resolved the calendar day in the SERVER's
  timezone on Postgres — measured: a UTC-12 server recorded yesterday; an
  Asia/Shanghai server records tomorrow for every default after 16:00 UTC — and
  MySQL 8.0 rejects it on a DATE column outright (MariaDB is merely permissive,
  and the driver's UTC-pinned session masked the semantic half there).
  `nowColumnDefault` now emits a UTC expression default on both dialects, the
  #3994 D-C3 construction one type over. Defaults only govern newly created
  columns; existing columns keep their legacy default, per the standing D-B3
  policy.

- 39eb01b: fix(driver-sql): a currently-declared unique index is never legacy debt — index drift no longer ping-pongs (#3955)

  An object may declare both a tenant-scoped field-level `unique: true` and an
  object-level single-column unique index on the same column:

  ```ts
  email: Field.email({ unique: true }),
  indexes: [{ fields: ['email'], unique: true }],
  ```

  The declared index materializes under `buildIndexName` as
  `uniq_<table>_<column>` — which is also one of the two spellings
  `legacyUniqueIndexNames` looks for when hunting pre-#3696 platform-wide
  uniques. The detector therefore read an index the current metadata declares
  as legacy debt and proposed replacing it with the tenant composite (which
  the same sync had already created).

  The resulting plan never converged: `apply` dropped the declared index, the
  next `plan` reported it missing and recreated it, and the one after that
  called it legacy again — an unbounded drop/create cycle on a live unique
  index, every round rendered as a "safe" change.

  `legacyUniqueReplacements` now takes the object's `declaredIndexes` and
  filters their normalized names out of the legacy candidate set, so an index
  metadata declares today is never mistaken for debt. Genuinely legacy indexes
  are still retired, including the knex-spelled `<table>_<column>_unique` when
  only the `uniq_…` spelling is declared.

- 4384921: fix(spec,drivers): `bypassTenantAudit` becomes a declared driver option, and `findOne` stops accepting a bare id (#4311)

  Three drivers built with `tsup` and tested with `vitest`, so no `tsc` had ever
  read them. Onboarding them to the #4311 type-check ratchet surfaced 292 errors,
  and most of what looked like sloppy test fixtures was the types being wrong.

  **`DriverOptions.bypassTenantAudit` is now declared.** It has been live for a
  long time without being on the schema: `SqlDriver.auditMissingTenant` reads it
  to suppress the "tenant-scoped write without `tenantId`" warning, the driver's
  own warning text tells callers to set it, `ObjectQLEngine` sets it for
  system-context calls, and `service-settings` / `service-datasource` pass it on
  every global-scope write. Because the schema never had it, the driver read it
  through `(options as any)` and no caller was type-checked. The declaration
  states the limit as well: it silences a diagnostic and MUST NOT change which
  rows a write touches — suppressing an audit warning is not a permission.

  The same cast covered `timezone`, `tenantId`, `tenantIds` and `preserveAudit`,
  all long since declared. Those reads now go through `DriverOptions`, so the next
  undeclared option fails the build instead of hiding behind an existing cast.

  **`SqlDriver.findOne(object, id)` is removed.** An undeclared
  `typeof query === 'string' | 'number'` branch accepted a bare id. It was on no
  contract, nothing outside that package's own tests used it, and the other two
  drivers answered the identical call differently — `MemoryDriver` spreads the
  string into `{0:'t',1:'1'}`, `MongoDBDriver` reads `query.where` as `undefined`
  and returns an arbitrary row. It also bypassed the shared `findRows()` path, so
  it skipped field selection, temporal coercion, unknown-column recovery and the
  `singleRowLookup` ORDER BY decision. Spell an id lookup as the query it is:

  ```ts
  -(await driver.findOne("task", "t1"));
  +(await driver.findOne("task", { object: "task", where: { id: "t1" } }));
  ```

  **`SqlDriver.initObjects` declares the `tenancy` it consumes.** Each object is
  fed to `computeAndRecordTenantField`, which reads `obj.tenancy` to pick the
  tenant column and to set or clear the sticky explicit-opt-out — but the
  parameter type listed only `{ name, fields }`, so a caller that spelled the key
  correctly was rejected while the driver read it anyway.
  `registerExternalObject` already had it.

  **`AnalyticsQueryInput` joins `AnalyticsQuery`.** `timezone` is
  `.default('UTC')`, so the parsed type requires it and an authored literal does
  not have it — the same two-tier split `QueryInput`/`QueryAST` already names on
  the query side. `InMemoryDriver.create`/`bulkCreate` also declare their
  `IDataDriver` return types; without them TS inferred the literal the method
  builds and every other column of the created row disappeared from the caller's
  view.

  One silent runtime bug fell out of the same pass: a driver test asked for
  `orderBy: [['id', 'asc']]`, the driver reads `item.field`, a tuple has none, and
  the sort never reached SQL. The tuple spelling appears nowhere else.

- 6f98c2d: fix(driver-sql,driver-memory): an uncompilable filter now throws instead of matching everything (#3948)

  A filter the driver could not compile was **skipped**, not rejected. No predicate
  was emitted and the query returned every row — the caller asked to filter and
  silently received the unfiltered set.

  The reachable shape is a bare comparison triple. `['close_date','before','2024-01-01']`
  arrives at a driver only when `isFilterAST()` refused it — its operator is outside
  `VALID_AST_OPERATORS`, so `parseFilterAST()` never converted it and the raw array
  was assigned to `where`. `driver-sql`'s loop then saw three _strings_, matched
  neither `and` nor `or`, and `continue`d past all three. `driver-memory` was worse:
  it cast every string to a logic keyword, opening three empty groups and returning
  `{}` — a filter matching every record.

  This is reachable from ordinary authoring, not just malformed input: `before` and
  `after` are canonical `VIEW_FILTER_OPERATORS` members that `VALID_AST_OPERATORS`
  does not accept. Eight of the nineteen canonical view operators are in that
  position, including `equals`; the others were masked only because ObjectUI's
  adapter alias table happened to cover them.

  **Behaviour change.** Both drivers now throw on a filter element that is neither a
  logical keyword (`and`/`or`) nor a condition array, and `driver-memory` throws on
  an operator it cannot express rather than dropping the condition. The nested and
  `$`-object paths already threw on the same input, so this makes the three paths
  agree. A caller that was relying on the old silence was receiving wrong results;
  the error names the operator and the offending filter.

  **`driver-memory` also gains seven operators it silently ignored:** `not_in`,
  `is_null`, `is_not_null`, `isnull`, `isnotnull`, `is_empty`, `is_not_empty` — all
  members of `VALID_AST_OPERATORS`, all previously falling through to
  `default: return null`. `is_null` narrowed nothing instead of matching null rows.
  Alias sets and semantics mirror `driver-sql`'s `whereNull`/`whereNotNull` arms so
  the two backends accept one vocabulary.

  Migration: none for well-formed filters. If a query now throws, the filter was
  never being applied — fix the operator (the message names it), or lower it to an
  AST spelling. `before` → `<`, `after` → `>`, `'not in'` → `nin`.

- a13827e: fix(data): paging a sorted read is a partition of the result set, not five queries that share a WHERE clause (objectui#3106)

  `ORDER BY status LIMIT 50 OFFSET 50` names a sort key that does not identify a
  row, and no backend promises that rows with equal keys keep the same relative
  arrangement between two queries. MongoDB documents this outright — `sort` +
  `skip`/`limit` on a non-unique key "may return the same document more than
  once". So page 2 could repeat a row page 1 already showed and skip one nobody
  ever saw:

  ```
  page 1: ORDER BY status LIMIT 5 OFFSET 0   -> [r05 r07 r11 r04 …]
  page 2: ORDER BY status LIMIT 5 OFFSET 5   -> [r04 …]        r04 again; one row never served
  ```

  Every page is full, every row is real and belongs, and the duplicate sits
  several screens from the omission — which is why this is found by a user
  counting records, never by reading a response.

  `SqlDriver` and `MongoDBDriver` now append a unique tie-breaker to any non-empty
  `orderBy`, in the last requested key's direction (determinism holds either way,
  but a same-direction suffix is the one an index can still walk in one pass).
  `driver-memory` already conformed — `Array#sort` is stable over a table whose
  order does not move — and now has a suite saying so, because that property is
  implicit and easy to lose in a refactor that looks like a speed-up.

  `SqlDriver` adds it only for objects it created itself (`initObjects` records
  those). A federated table (ADR-0015) may have no `id` column, and guessing there
  would be worse than doing nothing: the unknown-column error is answered by
  #3821's ladder retrying with **no ORDER BY at all**, trading a reshuffle among
  ties for the loss of the caller's whole sort.

  The obligation is now normative on `IDataDriver.find`, with shared cases in
  `@objectstack/spec/data` (`PAGINATION_CASES`) that all three drivers run — so a
  future driver is held to it by a gate rather than by remembering.

  Not covered by this change: a paged read with **no** `orderBy`. Same defect,
  wider blast radius, so it was carved out to #4363 rather than folded in — and
  closed there, in the same release. The contract, the shared cases and both
  drivers now cover a paged read whatever its `orderBy`, including none at all.

- 3fe0ff1: fix(driver-sql): `os migrate plan` no longer promises columns the apply can never create (#3978)

  `previewDeferredSchemaWork()` listed every declared field name when computing
  pending `create_table` / `add_columns` work, but `createColumn` returns early
  for a virtual `formula` field — no column is ever created for it.

  So a formula field showed up as pending `add_columns` that `apply` reported as
  performed without doing anything, and the very next `plan` reported it again.
  A freshly-applied database looked permanently un-migrated, with no invocation
  able to clear the finding. On `examples/app-crm` that was 4 columns
  (`crm_contact.full_name`, `crm_lead.is_closed`, `crm_opportunity.expected_revenue`,
  `crm_opportunity.days_to_close`) reported forever.

  The preview now filters through `fieldHasColumn` — the same helper `createColumn`
  and the column differ already answer "does this field materialize a column?"
  with — so the plan and the flush cannot disagree. `multiple` fields are
  unaffected: they materialize as a JSON column and are still reported.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                              |
  | :---------------------------------------------------------------- | :--------------------------------------------------------------- |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`        |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                              |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | `fields: ['owner.name']` (dotted path)                           |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias` |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- 8b50cb3: fix(data): a paged read with no `orderBy` is a partition too — the shape every list view actually sends (#4363)

  objectui#3106's server half closed the **sorted** paged read: a non-empty
  `orderBy` now carries a unique tie-breaker, so `ORDER BY status LIMIT 50 OFFSET
50` can no longer serve one row twice while never serving another. It stopped
  there deliberately. This closes the half it left, which is the more common one.

  A list view whose metadata configures no `sort`, on which nobody has clicked a
  column header, sends no `$orderby` at all. `SqlDriver` and `MongoDBDriver` then
  emitted a bare `LIMIT`/`OFFSET` — and neither backend promises anything about
  the order that slices:

  - **SQL** leaves the row order of an unordered read to the plan. Small tables
    hand back insertion order in practice, which is exactly why this survives
    testing; a parallel scan, an index scan, or a `VACUUM` need not.
  - **MongoDB** returns natural order, which describes where a document currently
    sits in its extent — and moves when the document does.

  Every row ties with every other on an empty sort key, so this is the same defect
  at full strength rather than a different one: page 2 repeats a row page 1 showed
  and drops one nobody sees, with every page full and every row real.

  Both drivers now order a paged read by their unique key column when the caller
  supplied no sort keys — the same `id` the tie-breaker was already appending, now
  standing alone. `driver-memory` again needed no change: it slices its backing
  array, and two reads with no write between them see the identical sequence. The
  contract asks for a partition, not for id order.

  **Unpaged reads are untouched, deliberately.** The rule keys off `limit`/
  `offset`, not off `orderBy` being absent. A read with neither hands back the
  whole matching set, so no caller can be shown a partial view of it, and sorting
  every read in the system would change plan selection to buy nothing. `limit`
  alone does count as paged: page one of a walk is routinely `limit=50` with no
  offset, and ordering only the later pages would leave the defect fully intact.

  `SqlDriver` keeps the existing restriction to objects it created itself
  (`initObjects` records them). It matters more here than for the sorted case: on
  a federated table (ADR-0015) there is no requested sort for #3821's ladder to
  fall back to, so a wrong guess about `id` would turn a reshuffle into a failed
  read. Those tables now get a warning — once per object, behavior unchanged —
  because the contract states determinism as a MUST, and a MUST that quietly does
  not hold is the same invisible failure the rule was written against.

  `findOne` is deliberately outside all of this, and the contract now says so.
  Engines reach a driver with `limit: 1`, which is shaped exactly like page one of
  a walk, but it promises _a_ matching record rather than a position in a
  sequence — nothing for a second call to be inconsistent with. Reading it as a
  page would put `ORDER BY id LIMIT 1` on the hottest read in the system, which is
  the classic shape for a planner to abandon the predicate's own index: measured
  on Postgres 16 over 2M rows, `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms
  and swapped the `owner_id` index for the primary key. `MongoDBDriver.findOne`
  has never sorted, so this also puts the two drivers back in step.

  The obligation is normative on `IDataDriver.find` and the cases are shared —
  `PAGINATION_UNORDERED_CASES` alongside `PAGINATION_CASES` in
  `@objectstack/spec/data` — so a future driver is held to both halves by a gate
  rather than by remembering.

- 0166bd5: fix(spec,drivers): the view filter vocabulary and the AST vocabulary now agree (#3948)

  `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) is what an author may declare on a
  `ViewFilterRule`. `VALID_AST_OPERATORS` (`data/filter.zod.ts`) gates
  `isFilterAST()`, which decides whether a filter is parsed into a query at all.
  They disagreed on **8 of 19** members: `equals`, `not_equals`, `greater_than`,
  `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `before`, `after`.

  An author could declare any of them, `ViewFilterRuleSchema` validated them,
  `defineStack` accepted them — and then `isFilterAST()` refused the filter, the
  protocol passed the array through unconverted, and the driver could not apply it.
  Six of the eight were reachable only in theory because ObjectUI's adapter alias
  table happened to translate them; the safety of the query path was resting on a
  hand-written table in another repository being complete, and for `before`/`after`
  it wasn't.

  **`AST_OPERATOR_MAP` is now the single source of truth.** `VALID_AST_OPERATORS`
  is derived from its keys rather than restated, so an operator can no longer be
  accepted by the gate without also having a lowering — the two were separate
  hand-written lists that happened to agree, with nothing enforcing it. The map
  gained the eight canonical view spellings plus the squashed/short forms stored
  metadata carries (`notequals`, `greaterthanorequal`, `eq`, `gt`, …).

  **New export `canonicalAstOperator(op)`** folds every accepted spelling of one
  comparison onto a single infix form. Both drivers now call it instead of growing
  private alias lists, which is what let them accept different vocabularies.
  `like`/`ilike` are deliberately not folded onto `contains`: driver-sql passes them
  to SQL verbatim, so folding would silently wrap the value in `%…%`.

  Widening only — no spelling was removed, so no stored filter stops validating.
  A filter that previously produced an error (after #4029) or was silently dropped
  (before it) now compiles. `filter-view-operator-parity.test.ts` asserts every
  `VIEW_FILTER_OPERATORS` member and every `VIEW_FILTER_OPERATOR_ALIASES` key has a
  lowering that is a real `$`-operator rather than the `$${op}` fallback, so the
  next operator the view layer gains fails a test instead of a query.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/observability@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 32d3800: fix(driver-sql): bound a connection attempt at 10s, and correct the "no reconnection" claim (#3769, #3759)

  Two related corrections, both from measuring what #3741/#3751/#3765 had only asserted.

  **The claim was wrong.** #3751 and #3765 shipped several statements that drivers
  never reconnect — "there is no lazy reconnection", "NOT retried and NOT
  reconnected", "stays disconnected for the process lifetime". Measured, both
  drivers recover on their own:

  - driver-mongodb: killing a real `mongod` and restarting it on the same port,
    the _same_ driver instance served the next write successfully (13ms), with no
    reconnect call from us — the official driver's topology monitor handles it.
  - driver-sql: a knex/pg pool is not poisoned by an outage. Its error tracks live
    server state (`ECONNREFUSED` while down → a handshake error once a listener is
    back → `ECONNREFUSED` again), i.e. every acquire opens a fresh connection.
    `storage-driver.ts` also configures `pool.min: 0`, so no stale idle
    connections are held.

  The original reasoning grepped this repo for `reconnect`, found nothing, and
  concluded recovery does not happen — but the recovery lives in the client
  libraries, not in our code. The claims are now corrected in `DriverConnectError`,
  the `DEGRADED BOOT` banner, `resolveAllowDriverConnectFailure`'s docs, and the
  drivers / self-hosting pages.

  **Fail-fast at boot is unchanged and still correct** — the reason is just
  different. It is not that the connection can never return; it is that the _boot
  sequence_ never re-runs. A driver that missed `init()` also missed
  `syncRegisteredSchemas()`, so its tables can simply not exist even after the
  database comes back. The banner now says that.

  **The real defect underneath.** `SqlDriver` passed its config to knex untouched,
  so a database endpoint that accepts TCP but never completes the handshake — an
  overloaded instance, a half-open firewall, a load balancer mid-failover — made
  every query wait out tarn's 30s default, then fail with `Timeout acquiring a
connection. The pool is probably full`, pointing an operator at pool sizing
  instead of the network. With a small `pool.max` a few such queries saturate the
  pool and everything else queues.

  `SqlDriver` now defaults `pool.createTimeoutMillis` to **10s**, matching
  driver-mongodb's existing `connectTimeoutMS ?? 10_000` so both drivers give up on
  an unreachable server at the same point. A host that sets its own
  `createTimeoutMillis` is left alone.

  **Migration.** None for a healthy datasource. A deployment that deliberately
  relies on connection establishment taking longer than 10s (a slow cross-region
  replica) should set `pool.createTimeoutMillis` explicitly on its `SqlDriver`
  config.

  Not fixed here, tracked in #3769: knex still reports the bounded wait as "the
  pool is probably full". An accurate message needs a dialect-specific connect
  timeout (pg's `connectionTimeoutMillis`), which changes the shape of `connection`
  and would regress the startup banner's URL display.

- 5d4de37: fix(objectql,driver-sql)!: a group key is the column's value, in the shape `find()` presents it (#3849)

  `groupBy: ['qty']` now returns `3`, not `'3'`. `groupBy: ['won']` returns `true` /
  `false`, not `'true'` / `'false'` on one path and `1` / `0` on the other. A bucket
  key is a column value, so there is one right answer for what it looks like —
  whatever that column looks like on a `find()` row — and all three paths that
  produce one now give it.

  ### What was wrong

  Three code paths produce a group key, and no two of them agreed:

  |                           | `qty` (number)   | `won` (boolean)                 |
  | ------------------------- | ---------------- | ------------------------------- |
  | `find()`                  | `3` number       | `true` boolean                  |
  | `aggregate()` pushed down | `3` number       | `0` / `1` **number**            |
  | in-memory fallback        | `'3'` **string** | `'false'` / `'true'` **string** |

  Two independent causes:

  - `applyInMemoryAggregation` ran every key through `String()`. The pushed-down
    path never did.
  - The pushed-down path returns raw builder output. #3797 taught it to present
    temporal columns the way `formatOutput` does on a `find()` row, but not the
    boolean and numeric repairs — so a SQLite boolean, which has no native type and
    is stored as `0`/`1`, surfaced as an integer from `aggregate()` and as a real
    boolean from `find()`.

  `engine.aggregate` chooses between the two aggregate paths per query — by whether
  the driver aggregates natively, whether it advertises the requested granularity,
  and whether the reference timezone is UTC — so the same column changed shape with
  no change to the data or the query.

  ### Why it mattered

  The measures were always right, which is why this went unnoticed. What broke was
  downstream code that probes a raw `Map` keyed by the value's own type. `Map`
  lookup is SameValueZero, so `'1'` never finds `1`:

  - **Select-option labels** (`dimension-labels.ts`) — the label table is keyed by
    the option's own `value`. A numeric option value never matched a stringified
    key, so the chart rendered the raw stored value instead of its label.
  - **Lookup / master-detail labels** — the id → record-name table is built by an
    inner query that always pushes down (raw ids), then probed with the outer
    query's keys, which may be in-memory (stringified). With a numeric primary key
    — routine for external/federated objects — every label missed.
  - **Cross-object rebucketing** (`cross-object-rebucket.ts`) — the FK → attribute
    map is built and probed the same way, and a miss is not a fallback but
    `RESTRICTED_BUCKET`. A numeric FK filed **every row** under `'(restricted)'`:
    one bar, correct grand total, no error.
  - **Drill-through** — the raw dimension value goes into the drill filter
    verbatim, so a boolean dimension drilled from the in-memory path sent
    `{ won: 'true' }` to SQLite, whose INTEGER column cannot equal the text
    `'true'`. Zero rows.

  ### What changed

  - `applyInMemoryAggregation` (`@objectstack/objectql`) emits the value verbatim.
    Its rows come straight from `driver.find()`, so passing the value through is
    what makes the key equal the column's own read shape.
  - The internal composite bucket id is now type-preserving, so `1` and `'1'`,
    `true` and `'true'` stay distinct groups rather than merging on the way in.
    BigInt is encoded explicitly — `JSON.stringify` throws on it, and a value that
    used to bucket under `String()` must not start crashing the aggregate.
  - `SqlDriver.aggregate` / `.distinct` (`@objectstack/driver-sql`) present group
    keys and `min`/`max` results with the same rules `formatOutput` applies on a
    `find()` row, generalizing the #3797 temporal fix to boolean and numeric
    columns. The `protected` helpers behind it are renamed accordingly
    (`temporalFieldKind` → `readPresentationKind`, `presentTemporalValue` →
    `presentReadValue`, `presentTemporalColumns` → `presentReadColumns`) and the
    kind union is exported as `ReadPresentationKind`.

  Date-bucketed `groupBy` items are unaffected: `bucketDateValue` and the dialect
  bucket expressions both produce canonical string labels, and #3839 already pinned
  their empty bucket.

  ### Gate

  `packages/qa/dogfood/test/group-key-read-shape-parity.test.ts` measures both
  aggregate paths against `find()` for a number, boolean and text column, on
  `driver-sql` and `driver-sqlite-wasm`. It asserts the runtime TYPE, not just the
  value — folding both sides through `String()` is the reflex that hid this in the
  first place and would make the check pass against the bug it exists to catch.

  Each half was confirmed to fail the gate on its own: reverting only the
  in-memory change reddens the number and boolean cases, reverting only the driver
  change reddens the boolean cases with `0<number>` against `false<boolean>`.

- dac6a08: feat(driver-sql)!: make index drift visible to `os migrate plan` — no more silent DDL at boot (#3728)

  The #3696 unique-scope migration converged **in place**: `syncTableIndexes` ran a
  `DROP` + `CREATE UNIQUE INDEX` during `initObjects`, in every environment,
  leaving one log line behind. `os migrate plan` showed nothing, because
  `detectManagedDrift` was column-only — `ManagedDriftOp` had no index dimension at
  all. An operator who wanted to review the DDL before it reached their database
  had no way to, and a managed schema was being auto-altered in production, which
  the #2186 contract explicitly forbids.

  Index drift is now a first-class dimension, reconciled through the same path as
  column drift:

  - **`syncTableIndexes` is additive only.** It creates indexes; it never drops or
    rewrites one. `dropLegacyGlobalUniques` is gone.
  - **New `DriftOp` variants** — `replace_unique_index` (safe: retire the legacy
    platform-wide unique in favour of the tenant composite), `create_index` (safe),
    `recreate_index` (needs-confirm; destructive when it tightens to `UNIQUE`), and
    `drop_index` (destructive).
  - **`detectManagedDrift` reports them**, `os migrate plan` renders them (index
    ops display as `table [index_name]`), and `os migrate apply` executes them.
    Index DDL is portable, so it applies directly on every dialect — no SQLite
    table rebuild.
  - **`replace_unique_index` creates before it drops**, so uniqueness is never
    unenforced mid-migration and a failed create leaves the schema untouched.
  - **Declared `indexes[]` drift is covered too**: an index metadata declares but
    the database lacks, and one whose definition no longer matches the declaration
    (the additive sync skips those by name, so they could never self-heal).
  - **Orphan detection is limited to ObjectStack's own generated naming**
    (`uniq_…` / `idx_…`, plus the pre-#3696 `<table>_<column>_unique` knex
    spelling). A hand-rolled operational index is never reported as drift and
    `--allow-destructive` will not delete it.

  **Behaviour change.** Boot no longer rewrites the index unconditionally. Dev
  (`autoMigrate: 'safe'`, what `os dev` / `os serve` use) still self-heals on
  restart, so local workflows are unchanged. Production now **warns** with an
  actionable `os migrate` hint and leaves the schema alone — the deployment stays
  on the legacy global unique (multi-tenant inserts still collide) until someone
  runs `os migrate apply`. That is the deliberate trade: a visible, pre-inspectable
  migration instead of an invisible one.

  Also fixed: `managedObjectIndexes` was never cleared when an object dropped its
  `indexes[]`, so drift detection kept expecting an index nobody declared.

  `SchemaDiffEntryKind` gains `index_mismatch` and `unmapped_index`.

- 7457a09: fix(driver-sql): give the bounded connection attempt an accurate error message (#3769)

  #3781 bounded a connection attempt at 10s via `pool.createTimeoutMillis`, which
  stopped the 30s hang but kept knex's own wording: `Timeout acquiring a
connection. The pool is probably full`. The pool is not full — the server never
  completed the handshake — so that message sends an operator to tune `pool.max`
  while the network is what is broken. This is the same defect class the boot
  guard in #3741 was about: an error that reads nothing like its cause.

  `SqlDriver` now also sets the **dialect's own** connect timeout, which fails with
  a message that names what happened:

  | client                                           | key                       | message             |
  | ------------------------------------------------ | ------------------------- | ------------------- |
  | `pg` / `postgres` / `postgresql` / `cockroachdb` | `connectionTimeoutMillis` | `timeout expired`   |
  | `mysql` / `mysql2`                               | `connectTimeout`          | `connect ETIMEDOUT` |

  Carrying the timeout requires `connection` to be an object, so a URL string is
  moved into the dialect's URL slot (`connectionString` for pg, `uri` for mysql2).
  Verified against a black-holing listener that both forms still reach the URL's
  own host/port and still honour `?sslmode=require`. SQLite is untouched — opening
  a file has no handshake to time out.

  **The two bounds are deliberately unequal.** They race and knex wins a tie, so
  equal values would let the pool timeout fire first and the accurate message would
  never be seen. The dialect timeout is the effective bound at **10s**; the pool
  timeout is a strictly looser backstop, raised from 10s to **15s**, reached only
  by a dialect with no connect-timeout knob or one that ignores the one we set.

  `driver.config` keeps the shape the author passed — the rewrite applies only to
  what knex receives. Two existing readers depend on that: `serve.ts`'s startup
  banner and `createDatabase()`, which parses the URL to swap in the maintenance
  database. A test pins it.

  `createDatabase()`'s own admin connection now gets the same bound; it is opened
  during boot against the very server we already suspect is unreachable, so it must
  not be the one place that still waits 30s.

  **Migration.** None for a healthy datasource. A deployment that deliberately
  needs longer than 10s to establish a connection (a slow cross-region replica)
  sets `connection.connectionTimeoutMillis` (pg) or `connection.connectTimeout`
  (mysql2) explicitly, and it is left alone.

- b90086a: fix(driver-sql)!: `unique` materializes per tenant, ending its contradiction with the per-tenant autonumber sequence (#3696)

  `unique: true` became a **single-column global index that ignored `tenancy`
  entirely**, while the autonumber sequence table is keyed by
  `(object, tenant_id, field, scope)` and hands every tenant its own counter
  starting at 1. Two subsystems of the same platform contradicted each other:
  tenant B's `PROD-00001` was rejected by an index it could not see — **no user
  did anything wrong**, the platform's left hand refused what its right hand
  issued.

  The rejection also doubled as a **cross-tenant existence oracle**: a UNIQUE
  violation told tenant B that some _other_ tenant held the value, enumerable by
  probing emails / codes / names.

  **The contract now:**

  | Declaration                      | Materializes as                                                 |
  | -------------------------------- | --------------------------------------------------------------- |
  | `unique: true` + tenant column   | composite `(tenantField, field)` — unique **within** the tenant |
  | `unique: true`, no tenant column | single-column — single-tenant DDL is byte-identical to before   |
  | `unique: 'global'`               | single-column, always platform-wide                             |

  The tenant column comes first in the composite, so the index also serves the
  `WHERE tenant = ?` prefix scans every tenant-scoped read issues.

  **Declared `indexes[]` are deliberately unchanged.** They are materialized over
  exactly the columns listed — no tenant column is injected. The author already
  spells them out, per-tenant ones have always been written explicitly
  (`fields: ['organization_id', 'code']`), and many are legitimately platform-wide
  (a DNS hostname, a reserved slug, an external provider id). `'global'` is
  accepted there as a synonym of `true` so one vocabulary covers both spellings.

  **Migration is automatic and cannot fail.** Legacy indexes
  (`<table>_<col>_unique` from knex, `uniq_<table>_<col>` from the drift-rebuild
  path) are retired inline at schema-sync time. The old global constraint is
  strictly stronger than the new per-tenant one, so existing rows satisfy the
  replacement by construction — no dedup, no cleanup, no data touched. It
  converges at sync rather than waiting for a deliberate `os migrate` run because
  a deployment that never ran migrate would otherwise stay broken.

  **Upgrading — audit your `unique: true` fields.** On a tenant-scoped object the
  constraint is now per tenant. Anything that must stay platform-wide has to say
  so:

  ```ts
  hostname: Field.text({ unique: "global" }); // no two tenants may claim it
  ```

  Note the reach: `applySystemFields` injects `organization_id` into every
  registered object unless it opts out, and the driver falls back to that column
  when no `tenancy.tenantField` is declared — so most objects are tenant-scoped.
  Typical candidates for `'global'`: DNS hostnames, reserved slugs, external
  provider ids (Stripe customer/subscription), device identities.

  Postgres materializes `col.unique()` as a table CONSTRAINT rather than a bare
  index, so the retirement tries `DROP CONSTRAINT` before `DROP INDEX` —
  `DROP INDEX` alone would have made the migration a no-op on exactly the
  deployments that matter most.

  `@objectstack/driver-mongodb` accepts the new declaration but keeps single-field
  indexes: it implements no row-level tenancy at all (no tenant predicate on read,
  no tenant stamp on write), so a `(tenant, field)` index would advertise an
  isolation it does not deliver. Tracked separately.

### Patch Changes

- fa3d0cf: feat(spec): field runtime value-shape contract — ADR-0104 phase 1 (D1)

  `@objectstack/spec/data` now owns the runtime VALUE shape of every field type
  (`field-value.zod.ts`): semantic type classes (`STRING_VALUE_TYPES`,
  `NUMERIC_VALUE_TYPES`, `REFERENCE_VALUE_TYPES`, `FILE_REFERENCE_TYPES`,
  `STRUCTURED_JSON_TYPES`, `MULTI_CAPABLE_TYPES`, …), the shared
  `isMultiValueField`, and `valueSchemaFor(field, 'stored' | 'expanded')`. The
  four consumers that each hand-copied this knowledge (objectql record-validator,
  rest import-coerce, driver-sql column classification, qa conformance) now
  derive from the spec, and the field-zoo round-trip MATRIX is asserted against
  the contract so the two cannot drift.

  **Write-path change (objectql, warn-first):** previously-unvalidated types —
  single `lookup`/`master_detail`/`user`/`tree`, `file`/`image`/`avatar`/
  `video`/`audio`, `location`, `address`, `composite`, `repeater`, `record`,
  `vector` — are now checked against the contract. A violation **logs a warning
  and passes** in this release (legacy rows must not strand their records);
  set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` to enforce as a
  `400 VALIDATION_FAILED`. The flip to strict-by-default rides a later minor
  (ADR-0104 R1/R2).

  **Deprecations (removal rides the next spec major), FROM → TO:**

  - `CurrencyValueSchema` (`{value, currency}`) → none. A `currency` field's
    value is a **bare number** everywhere in the runtime (validator, SQL `float`
    column, import coercion, field-zoo oracle); the currency code lives in field
    config. Use `valueSchemaFor({type: 'currency'})`.
  - `LocationCoordinatesSchema` (`{latitude, longitude}`) → `LocationValueSchema`
    (`{lat, lng}`) — the shape the platform actually stores.
  - `AddressSchema` is **adopted** (unchanged) as the enforced `address` value
    contract via `AddressValueSchema`.

  No stored data changes shape; the contract codifies deployed reality
  ("reality wins", ADR-0104 D1).

- c7f4417: fix(driver-sql,analytics): stop `aggregate()` / `distinct()` leaking SQLite's raw epoch storage (#3797)

  Both returned `await builder` directly, without the `formatOutput` pass every
  `find()` row gets. On SQLite — the one dialect where a `Field.datetime` is
  stored as INTEGER epoch milliseconds rather than a native timestamp — that raw
  storage form went straight to the caller:

  | call                                   | before                       | after                            |
  | -------------------------------------- | ---------------------------- | -------------------------------- |
  | `find()`                               | `"2026-01-10T09:00:00.000Z"` | unchanged                        |
  | `distinct('closed_at')`                | `[1768035600000]`            | `["2026-01-10T09:00:00.000Z"]`   |
  | `aggregate()` `max(closed_at)`         | `1768035600000`              | `"2026-01-10T09:00:00.000Z"`     |
  | `aggregate()` `groupBy: ['closed_at']` | key `1768035600000`          | key `"2026-01-10T09:00:00.000Z"` |

  Same root cause as #3773, different exit. `Field.date` was never affected — it
  is ISO TEXT on every dialect, so its storage form already equals its
  presentation.

  The visible surfaces were a `_max`/`_min` measure over a datetime (a "last
  closed" KPI tile rendered `1768035600000`) and a `groupBy` on a raw datetime
  dimension, which also disagreed with the in-memory `applyInMemoryAggregation`
  fallback — that one consumes already-formatted `find()` rows, so the same
  dataset changed key type depending on which path served it.

  Which columns hold an instant is now recorded while the statement is built,
  because that is the only point where a column name and its meaning are both
  known: a `min()` lands under its alias and never under the field name, while a
  date-BUCKETED column lands under the field name but holds a label (`'2026-01'`)
  rather than an instant. Matching on names afterwards gets both backwards.

  `distinct()` additionally re-deduplicates after presenting: SQL `DISTINCT`
  compares STORED values, and one SQLite datetime column holds both INTEGER and
  TEXT forms, so two rows recording the same instant survived as two and then
  presented identically. It has no in-repo callers today; this keeps it honest
  rather than leaving a second convention in the driver.

  **`cross-object-rebucket` was fixed alongside it, because presenting min/max
  correctly is what exposed it.** `recombine()` coerced every operand with
  `Number()`, which silently depended on receiving an epoch: handed the ISO string
  the driver now returns it produced `NaN`, and on Postgres/MySQL (where knex
  returns a `Date`) it had always flattened the value back to an epoch integer one
  layer above the driver. `min`/`max` now order by the instant and return the
  winning value in the shape it arrived in; `sum`/`count` stay numeric.

- cf5e033: fix(driver-sql): `$or` branches AND their own contents again — every `$or` filter was widened

  `applyFilterCondition` passed `logicalOp='or'` _into_ each `$or` branch's
  recursive call. That flag is meant to decide only how a branch attaches to its
  parent builder, but inside the branch it also selected `orWhere` for the
  branch's own contents. So a branch's field keys — and the operators of a single
  field — OR-ed each other instead of AND-ing:

  | Filter                        | Compiled to           | Should be                |
  | ----------------------------- | --------------------- | ------------------------ |
  | `{$or:[{a:'x', b:'y'}]}`      | `a = 'x' OR b = 'y'`  | `a = 'x' AND b = 'y'`    |
  | `{$or:[{d:{$gte:X, $lt:Y}}]}` | `d >= X OR d < Y`     | `d >= X AND d < Y`       |
  | `{$or:[{$and:[A,B]}, {c,d}]}` | `(A AND B) OR c OR d` | `(A AND B) OR (c AND d)` |

  The Filter Protocol rule this breaks is Mongo's: **everything inside one filter
  object is AND-ed, at every depth.** A `$or` array OR-s its _branches_; it does
  not change how the contents _within_ a branch combine.

  Every miscompile widens the result set, never narrows it, so affected queries
  returned **more** rows than the filter allowed. Two shapes to re-check in your
  own metadata after upgrading:

  - **Scoping filters** that pair a discriminator with an id list per branch —
    `{$or:[{parent_object, parent_id:{$in:[…]}}, …]}` and similar — were not
    holding the pairing. Where such a filter decides visibility, it was returning
    rows outside the intended scope.
  - **Sharing-rule `criteria_json`** containing a `$or` whose branches carry more
    than one key (what a "match ANY of these groups" criteria builder emits). That
    path _writes_ `sys_record_share` grants, so any over-match materialized
    durable grants that outlive this fix — **re-reconcile those rules after
    upgrading**; the driver fix alone does not retract grants already written.

  Also affected: the abutting `$gte`/`$lt` window pattern the automation docs and
  CLI flow linter recommend for scheduled flows. Each tier degenerated to
  `d >= lo OR d < hi`, which matches every row, so multi-tier reminder flows fired
  on the whole table instead of one window.

  `driver-sql` was the sole divergent backend — `driver-memory`,
  `driver-mongodb`, the analytics `read-scope-sql` compiler and the write-side
  `matchesFilterCondition` evaluator all already AND-ed per node. Conformance
  tests now pin the same shapes across the three in-repo evaluators so they cannot
  drift apart again. `driver-sqlite-wasm` inherits the fix (it extends
  `SqlDriver`); Postgres, MySQL, SQLite and sqlite-wasm were all affected.

  The `$and` arm also now honors `logicalOp`, as `$or`/`$not` already did. Nothing
  reaches it with `'or'` once the propagation above is fixed, but the two changes
  are only correct together — leaving one combinator deaf to the flag is how the
  rules drifted apart in the first place.

- 0e3a226: fix(authz): widen the driver's native tenant scope to the membership union
  under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

  The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
  under `group`, but the ObjectQL engine also propagated the active-org
  `tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
  scoping ANDed `organization_id = tenantId` under the union — collapsing every
  group read back to active-org (isolated) reach. Found by the cloud-side
  `ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
  against a real driver.

  - `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
    native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
    keeping the NULL-tenant global-row carve-out; inserts still stamp from
    `tenantId` (the active organization is the write target, D5). Absent or
    empty ⇒ equality fallback — fail toward isolation, never toward exposure.
  - ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
    `tenantIds` when the tenancy posture is `group`, reported by a new
    `setTenancyPostureProvider` seam.
  - SecurityPlugin wires that provider at start — deliberately from the
    enforcement layer, so the driver wall only widens while the Layer 0 union
    wall enforces above it. Embeddings without plugin-security keep active-org
    equality.

- 81ce41a: feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

  Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
  rows are no longer rejected by `initialStates` — but the OTHER half of a historical
  migration, preserving the original timeline, still didn't hold: an imported ticket
  that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
  importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
  fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
  sorting all came out wrong.

  Three layers were force-overwriting the timeline; all three now respect a single
  new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
  alongside `skipStateMachine`:

  - **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
    and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
  - **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
    `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
    symmetric with how `created_at` / `created_by` already behave on insert; and the
    static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
    audit/timestamp family plus author-declared business `readonly` fields — so an
    upsert refresh no longer drops them.
  - **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
    force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
    empty, mirroring the insert stamp).
  - **rest** — the import runner sets `preserveAudit` on the write context iff the
    request opts into `treatAsHistorical`.

  Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
  `system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
  columns) STAY stripped, so a historical import reinstates established facts without
  becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
  unaffected — this changes only which audit/readonly values the runtime overwrites,
  never who may write the record. Fully opt-in: a normal write still auto-stamps
  `updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
  "Import as historical data" checkbox (objectui#2815) now drives both halves — no new
  UI.

- 647ec8b: fix(driver-sql,sharing): an unsortable query loses its ORDER BY, not its rows (#3821)

  `SqlDriver.find()` already recovered from a SELECT projection naming a column
  the table lacks (retry with `select('*')`, the unknown field is simply absent
  from each row). The identical failure one clause over — an **ORDER BY** column
  the table lacks — fell through to `return []`. Because `count()` is a separate
  statement, the list endpoint answered `HTTP 200` with `records: []` and
  `total: 3`: the rows are there, none are shown, nothing is logged. Same family
  as the `$`-param footgun closed by #2926.

  It surfaced through the Console's sharing-rule **recipient picker**, which
  never listed a single candidate. The client mangled `'name asc'` into
  `0 n,1 a,2 m,…` (fixed separately in objectui) and the driver turned that into
  "no users exist", so no sharing rule could be authored from the UI at all.

  Rows now outrank their order: the retry ladder drops the projection first (the
  likelier culprit and the cheaper thing to lose), then the sort, then gives up.
  A query that cannot be sorted comes back **unordered instead of empty**. Errors
  that are not about an unknown column still propagate untouched.

  **A rule authored in Setup now actually applies — and switching it off actually
  withdraws access.** Writing a `sys_sharing_rule` rebound the per-record hooks,
  which only makes the rule reach records written FROM THEN ON. So an admin who
  created a rule and enabled it saw nothing happen: the recipient's list stayed
  empty until somebody happened to touch each record. The reverse was worse —
  switching a rule OFF, or deleting it, left every grant it had already issued in
  place, and boot backfill only reconciles ACTIVE rules, so those grants outlived
  restarts while the UI displayed the rule as disabled. The reconcile was reachable
  only through `POST /sharing/rules/:id/evaluate`, which the Console never calls.

  Each non-system write to `sys_sharing_rule` now also reconciles that rule's
  grants, chained behind the existing rebind: insert/update run the same
  diff-based `evaluateRule` the REST endpoint runs (it purges when the rule is
  inactive), and delete purges directly via the new
  `SharingRuleService.revokeRuleGrants` — `evaluateRule` can't help there because
  the row is already gone (`RULE_NOT_FOUND`), which is also why a rule deleted
  through the plain data API used to orphan its grants. Seeding and package
  bootstrap write with `isSystem` and are skipped; `kernel:bootstrapped` already
  backfills those. Reconciliation is best-effort and never fails the write.

  **The dialog's help text was engineering notes, shown to tenant admins.** The
  field descriptions on `sys_sharing_rule` render under each input in Setup, and
  they cited ADR numbers, table and column names (`parent_business_unit_id`,
  `sys_business_unit`), enum machine values the dropdown never shows
  (`business_unit`, `team`), a third-party library (better-auth), and engine
  vocabulary ("evaluation", "lifecycle"). Several were also stale: they still told
  admins to type an id or hand-write a `FilterCondition` after those inputs became
  a record picker and a visual builder. Rewritten for the reader who actually sees
  them — the implementation detail was already in the object's doc comment, which
  is where it stays. `criteria_json`'s LABEL loses its "(FilterCondition JSON)"
  suffix for the same reason, and `active` can finally say what it now does:
  turning it off withdraws the access.

  Also refreshes the `sys_sharing_rule` help text in the zh-CN / ja-JP / es-ES
  translation bundles, which still described `recipient_type` in terms of
  `department` (the enum value is `business_unit`) and told admins to enter a
  queue name for `recipient_id` (`queue` was removed in ADR-0078). The es-ES
  option labels for `position` / `unit_and_subordinates` were translated as
  "rol" — corrected to "Puesto" / "Unidad de negocio y subordinados".

- 5f0852f: fix(driver-sql): bucket a SQLite `Field.datetime` by its stored instant instead of collapsing every row into one `(null)` (#3773)

  On SQLite, any trend chart bucketed by day/week/month/year over a
  `Field.datetime` column put **every record in a single `(null)` bucket** — one
  bar, carrying the whole total. The measure was right; only the bucket key was
  wrong. `Field.date` (ISO TEXT storage) was unaffected, so the same dashboard
  could show one column working and the next one flat.

  better-sqlite3 stores a `Field.datetime` as INTEGER epoch **milliseconds** (knex
  binds a JS `Date` as `.getTime()`), and `buildDateBucketExpr` emitted a flat
  `strftime('%Y-%m', col)`. SQLite reads a bare integer as a **Julian day
  number**; an epoch-ms value is far outside the legal range, so `strftime`
  returned NULL for every row. Nothing downstream noticed: SQLite advertises
  `queryDateGranularity.month`, so `engine.aggregate` pushes the bucketing down,
  and its in-memory fallback only engages for an _unsupported_ granularity or a
  non-UTC timezone.

  The SQLite expression is now storage-aware, sharing one `isEpochStoredDatetime`
  predicate with the filter-comparand coercion added for the same root cause in
  \#2034 — a window and a bucket that disagree about storage is exactly how an
  epoch column ended up correctly filtered and then entirely bucketed as NULL.
  Postgres and MySQL are untouched: `defineColumn` maps `Field.datetime` to a
  native timestamp there, which is also why their comparands are left alone.

  Two details are load-bearing and pinned by tests:

  - The conversion dispatches on each **stored value's** type, not just the
    declared one. A SQLite `Field.datetime` column is genuinely mixed-form —
    `formatInput` passes datetime values through, so a `Date` lands as INTEGER
    while an ISO string (including an unresolved `defaultValue: 'NOW()'`) lands as
    TEXT. Dividing TEXT by 1000 coerces it to its leading year, filing live rows
    under 1970 — worse than the NULL it replaced.
  - Division is `/1000.0`, not `/1000`. Integer division truncates toward zero, so
    a pre-1970 instant (`-1` ms) would surface as 1970-01-01.

  `bucketDateValue` (the in-memory fallback in `@objectstack/objectql`) now reads a
  finite **number** as epoch milliseconds. `new Date(String(1767225600000))` is an
  Invalid Date, so a driver handing back raw storage values bucketed as `'(null)'`
  there while the pushed-down SQL bucketed correctly — fixing only the driver would
  have traded one wrong answer for two different ones, and the two paths have to
  label the same instant identically for a drill-down to survive crossing them.

  `SqliteWasmDriver` inherits `buildDateBucketExpr`, so it carried the bug and gets
  the fix.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/observability@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/observability@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- efbcfe1: feat(observability): admin-only richer per-request timing detail via `X-OS-Debug-Timing: json` (#2408)

  Completes the optional "richer JSON" diagnostic from #2408. In addition to the
  basic `Server-Timing` header, an admin/service caller can now request a
  per-query breakdown — the slowest SQL statements and a query count — by sending
  `X-OS-Debug-Timing: json`. The detail is returned in a separate
  `X-OS-Debug-Timing-Detail` response header (compact JSON) and is **admin-only,
  even under global mode**: an ordinary caller never sees SQL shapes.

  - **observability**: `PerfTiming` gains opt-in per-event detail capture
    (`enableDetail` / `recordDetail` / `details`) plus the ambient
    `recordServerTimingDetail`. The disclosure gate gains a `privileged` level
    (set by `allowPerfDisclosure`, read via `isPerfDisclosurePrivileged`) so the
    richer detail can be gated independently of the basic header.
  - **driver-sql**: when detail capture is on, the query listener additionally
    records each query's **parametrized** statement (knex's `q.sql`, `?`
    placeholders) — never the bindings, so no literal row value ever enters the
    collector. Zero overhead when detail is off.
  - **plugin-hono-server**: `X-OS-Debug-Timing: json` enables detail capture; the
    middleware emits `X-OS-Debug-Timing-Detail` (slowest queries, capped and
    sanitized to header-safe ASCII) only when the principal is a proven admin.

  Basic and global behavior are unchanged; `json` is purely additive.

### Patch Changes

- 47d923c: fix(driver-sql): drop the vestigial `sqlite3` peerDependency — the SQLite path uses `better-sqlite3` (#3277)

  `package.json` advertised `peerDependencies.sqlite3: "^5.0.0"`, but the driver never
  loads `sqlite3` at runtime. Every first-party SQLite construction site builds a
  `client: 'better-sqlite3'` Knex driver (`resolveSqliteDriver` in
  `@objectstack/service-datasource`, the datasource driver factory, and the whole
  driver test suite), and the README already tells consumers to `pnpm add better-sqlite3`.
  `better-sqlite3` is auto-provided as an `optionalDependency` (with the native → wasm →
  memory step-down of #2229 covering a failed native build), so the SQLite requirement is
  already satisfied without the consumer installing anything.

  The stale `sqlite3` peer only misled: a consumer resolving peer deps could `pnpm add
sqlite3` (never used) while believing they'd satisfied the SQLite requirement. Removing
  it aligns the declared contract with the code and the docs. The `sqlite3` string alias
  still maps to `better-sqlite3` in the driver factory and dialect detection, so
  `driver: 'sqlite3'` config keeps working — it just resolves to `better-sqlite3` like
  everything else.

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0
  - @objectstack/observability@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/observability@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- efbcfe1: feat(observability): admin-only richer per-request timing detail via `X-OS-Debug-Timing: json` (#2408)

  Completes the optional "richer JSON" diagnostic from #2408. In addition to the
  basic `Server-Timing` header, an admin/service caller can now request a
  per-query breakdown — the slowest SQL statements and a query count — by sending
  `X-OS-Debug-Timing: json`. The detail is returned in a separate
  `X-OS-Debug-Timing-Detail` response header (compact JSON) and is **admin-only,
  even under global mode**: an ordinary caller never sees SQL shapes.

  - **observability**: `PerfTiming` gains opt-in per-event detail capture
    (`enableDetail` / `recordDetail` / `details`) plus the ambient
    `recordServerTimingDetail`. The disclosure gate gains a `privileged` level
    (set by `allowPerfDisclosure`, read via `isPerfDisclosurePrivileged`) so the
    richer detail can be gated independently of the basic header.
  - **driver-sql**: when detail capture is on, the query listener additionally
    records each query's **parametrized** statement (knex's `q.sql`, `?`
    placeholders) — never the bindings, so no literal row value ever enters the
    collector. Zero overhead when detail is off.
  - **plugin-hono-server**: `X-OS-Debug-Timing: json` enables detail capture; the
    middleware emits `X-OS-Debug-Timing-Detail` (slowest queries, capped and
    sanitized to header-safe ASCII) only when the principal is a proven admin.

  Basic and global behavior are unchanged; `json` is purely additive.

### Patch Changes

- 47d923c: fix(driver-sql): drop the vestigial `sqlite3` peerDependency — the SQLite path uses `better-sqlite3` (#3277)

  `package.json` advertised `peerDependencies.sqlite3: "^5.0.0"`, but the driver never
  loads `sqlite3` at runtime. Every first-party SQLite construction site builds a
  `client: 'better-sqlite3'` Knex driver (`resolveSqliteDriver` in
  `@objectstack/service-datasource`, the datasource driver factory, and the whole
  driver test suite), and the README already tells consumers to `pnpm add better-sqlite3`.
  `better-sqlite3` is auto-provided as an `optionalDependency` (with the native → wasm →
  memory step-down of #2229 covering a failed native build), so the SQLite requirement is
  already satisfied without the consumer installing anything.

  The stale `sqlite3` peer only misled: a consumer resolving peer deps could `pnpm add
sqlite3` (never used) while believing they'd satisfied the SQLite requirement. Removing
  it aligns the declared contract with the code and the docs. The `sqlite3` string alias
  still maps to `better-sqlite3` in the driver factory and dialect detection, so
  `driver: 'sqlite3'` config keeps working — it just resolves to `better-sqlite3` like
  everything else.

- ce468c8: feat(observability): decompose `Server-Timing` into auth / db / hooks / serialize spans (perf-tuning mode)

  The opt-in `Server-Timing` header now breaks a request's server time into the phases that actually explain it, so an operator can open DevTools → Network → Timing and see where the time went without standing up an external tracing backend:

  - **`db`** — total SQL time with a **query count**. The SQL driver wires knex's `query` / `query-response` events (keyed by `__knexQueryUid`) and folds each query into one aggregate member (`db;dur=210;desc="6 queries"`) — the query count is the number most useful for spotting N sequential round-trips. Timing is attributed to the originating request via `AsyncLocalStorage`, so it is correct under concurrency and never cross-attributes. SQL text is never emitted, only durations and a count.
  - **`auth`** — identity / session resolution in the dispatcher, the prime suspect for unexplained data-API overhead.
  - **`hooks`** — total business-hook execution time with a hook count, fed through the engine's existing `HookMetricsRecorder` seam (wired from the runtime, so `@objectstack/objectql`'s lean `core` tier stays observability-free).
  - **`serialize`** — response JSON encoding in the HTTP adapter.

  Adds `countServerTiming(name, dur, unit)` (and `PerfTiming.count`) to fold high-frequency phases into a single aggregate member instead of flooding the header. Every phase is a no-op when perf-tuning is off (`serverTiming: true` / `OS_SERVER_TIMING=true`), so there is zero measurable overhead on the normal path.

  Closes #2408.

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/observability@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- 84650c5: Log a concise one-liner instead of the full `ERR_DLOPEN_FAILED` stack trace when native `better-sqlite3` cannot load (an ABI / `NODE_MODULE_VERSION` mismatch after a Node upgrade, or the native addon was never built). The native → wasm SQLite step-down is unchanged — this only stops a handled, non-fatal fallback from reading like a fatal crash in the dev console, and points at `pnpm rebuild better-sqlite3` for native speed. Any other `PRAGMA` failure keeps its full warning.
- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- ce6d151: fix(driver-sql): fail-loud on unknown filter operators; real IS NULL / IS NOT NULL; $not support (#2704)

  The SQL driver used to forward any filter operator it didn't recognise straight
  to Knex. On a null comparand that silently compiled to a whole-table match, so a
  permission/assignment-scoped list view could leak every row (e.g. an
  `is_null` / `is_empty` operator from the client). It also had no real
  null-check: `field = null` never renders `IS NULL` in SQL.

  This change makes the driver:

  - Render null predicates as real SQL — `is_null` / `isnull` / `is_empty`
    (and the not-null variants) → `IS NULL` / `IS NOT NULL`, unified with
    `equals` + null; `!= null` → `IS NOT NULL`.
  - Support the full spec operator set plus client alias spellings across both
    filter shapes (array `[field, op, value]` and object `{field: {$op: value}}`):
    `$between`, `$startsWith`, `$endsWith`, `$notContains`, `$null`, `$exists`,
    and the logical `$not` (a negated sub-condition, matching driver-mongodb /
    driver-memory — CEL `!expr` permission scopes compile to it).
  - LIKE-escape `contains` / `startsWith` / `endsWith` values with an explicit
    `ESCAPE '\'` so `%` / `_` in user input can't widen the match.
  - **Throw on a genuinely unknown operator** in both paths instead of silently
    passing it through — no more silent whole-table results.

  `@objectstack/spec` recognises the client alias operator spellings
  (`isnull` / `is_empty` / …) in `VALID_AST_OPERATORS` and maps them to `$null`
  so the array-AST → object-filter conversion is consistent with the driver.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- afa8115: Three permission-runtime fixes found dogfooding the ADR-0090 showcase zoo:

  **#2734 — driver tenant wall hid every global row.** `applyTenantScope` used
  strict `organization_id = :tenantId` equality, so any caller with an active
  org (every logged-in admin) saw ZERO rows in the org-less platform tables
  (`sys_position`, `sys_permission_set`, `sys_business_unit` — Setup → Access
  Control rendered empty on a fresh deployment) and none of the first-boot
  seeds (stamped before the default org exists). The scope is now
  `(organization_id = :tenantId OR organization_id IS NULL)`: a NULL tenant
  column marks a GLOBAL/platform row that belongs to no other tenant; rows
  stamped with a DIFFERENT org stay invisible exactly as before.

  **#2735 — bulkCreate skipped write-side marshaling.** The batch insert path
  (the common case for seeds/imports since #2678) handed raw object values
  (`location`/`json`/`array` fields) to the SQLite binder — "Wrong API use:
  tried to bind a value of an unknown type" — silently failing whole seed
  batches (showcase accounts/tasks/field-zoo seeded zero rows). `bulkCreate`
  now runs each row through the same `formatInput` + `applyWriteColumnMap` +
  timestamp-stamp sequence as `create()`, and decodes the read-back the same
  way.

  **#2737 — count()/aggregate() ignored injected read filters.** `engine.count`
  and `engine.aggregate` built a LOCAL ast inside the executor, discarding the
  RLS/OWD filters the security and sharing middlewares inject into
  `opCtx.ast.where` — `GET /data/:object` returned scoped `records` with an
  UNSCOPED `total` (a row-count oracle over invisible records, broken
  pagination). Both now carry their ast on the opCtx exactly like `find()`.

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Patch Changes

- 21420d9: Seed loader and data-import now route bulk writes through the engine's array-form `insert()` (one round-trip per batch, with parent-deduplicated summary recompute) instead of one `insert()`/`createData()` call per record, and both retry transient driver errors instead of silently dropping the row (#2678).

  A new shared helper, `bulkWrite` (`@objectstack/core`), batches rows through a caller-supplied batch-write function, retries a whole-batch transient failure (network blip / timeout) with exponential backoff, and degrades to per-row writes (each itself retried) when a batch fails for a non-transient reason — so one bad row can't drop the other N-1. `withTransientRetry` wraps a single write (e.g. an update) with the same retry behavior.

  - `SeedLoaderService.loadDataset()` (`@objectstack/metadata-protocol`) buffers insert-mode records and flushes them in batches of 200 via the engine's array `insert()`. Datasets with a self-referencing field (e.g. `employee.manager_id -> employee`) keep the historical per-record write path, since a later record may need an earlier one's freshly-assigned id.
  - `runImport()` (`@objectstack/rest`) buffers create-resolved rows and flushes them via `protocol.createManyData()` when the protocol supports it, falling back to the original per-row `createData()` call otherwise. `Protocol.createManyData` (`@objectstack/metadata-protocol`) now forwards `context` to `engine.insert()` like `createData` already did, so tenant-scoped bulk creates work correctly.

  Previously, a 1000-row seed or import into an object with a rollup summary issued 1000+ round-trips and up to 1000 summary recomputes; a single transient network error on any one row silently dropped it with no retry (the 2026-07-06 HotCRM first-boot incident). A `bulkCreate`-capable driver now sees roughly `ceil(N/batch)` writes, and a transient error is retried before a row is ever reported as failed.

  **Fix (`@objectstack/driver-sql`):** `SqlDriver.bulkCreate()` never generated a client-side id for a row missing one, unlike `create()` — a latent gap that this change is the first to exercise at scale (a bulk-inserted row without a driver-native id default silently landed with `id: NULL`). `bulkCreate()` now mirrors `create()`'s id/`_id` normalization per row.

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- 8d87930: Fix a connection-pool deadlock when the first `auto_number` write after process
  start goes through a transaction (e.g. `POST /api/v1/batch`, which wraps every
  operation in one `ql.transaction(...)`).

  The sequence-counter table (`_objectstack_sequences`) was created lazily on the
  first autonumber INSERT via a bare `this.knex.schema.*` call that asks the pool
  for a second connection. On SQLite (better-sqlite3, pool max=1) the open batch
  transaction already holds the only connection, so the acquire blocked until
  `Knex: Timeout acquiring a connection`. Postgres/MySQL are exposed to the same
  pool-exhaustion deadlock under concurrent cold first-writes.

  Fixes:

  - `initObjects` now pre-creates the counter table up front, outside any data
    transaction, so the first write never runs DDL (primary fix).
  - The lazy fallback (`ensureSequencesTable`) now runs its DDL on the caller's own
    transaction on SQLite instead of grabbing a second connection. It deliberately
    does not route DDL through the caller's transaction on MySQL, where DDL would
    implicitly commit the caller's in-flight transaction.
  - Added a dev/test guard (`assertBareKnexSafe`): on SQLite, issuing a bare
    `this.knex` query while a transaction holds the single pooled connection now
    fails fast with an actionable error instead of hanging until the opaque
    `Knex: Timeout acquiring a connection`. No-op in production and on non-SQLite
    dialects, so it adds no runtime cost on the hot path — it just turns this whole
    class of "forgot to thread the transaction through" bug into an immediate,
    self-explaining failure at the call site.

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Minor Changes

- d980f0d: feat: add a first-class `user` field type (person picker)

  A new `user` field type — the equivalent of Airtable's Collaborator / Notion's
  Person / Salesforce's `Lookup(User)`. Authored as `Field.user({ ... })`; use
  `{ multiple: true }` for collaborators/watchers and `{ defaultValue: 'current_user' }`
  to auto-fill the acting user on create.

  **Why a distinct type rather than telling authors to `Field.lookup('sys_user')`:**
  selecting a person is table-stakes, but the value is in _modelling
  discoverability_ — a "User" entry in the Studio/AI field palette instead of
  requiring authors (and AI) to know to reference the internal `sys_user` system
  object — plus `current_user` defaults and a user-search picker. Storage and
  runtime are unchanged.

  **Deliberately NOT a new storage primitive.** `user` is a _semantic
  specialization of `lookup`_ with the target fixed to `sys_user`: it shares the
  exact lookup code path — same FK string column (`multiple` ⇒ JSON), same
  `$expand` resolution, same indexing — so referential integrity and fresh display
  names come for free, and nothing is re-implemented. An existing
  `Field.lookup('sys_user')` is therefore equivalent at the storage layer (zero
  data migration to adopt `Field.user`).

  Ownership semantics are **unchanged**: the existing `owner_id` convention +
  `plugin-security` auto-stamp/RLS still apply. A declarative `owner` flag is a
  possible future follow-up; intentionally not added here to avoid a second
  field type for what is a system role (rationale: keep the `FieldType` surface
  lean — see related ADR-0059 freeze discipline).

  Changes: `FieldType` gains `'user'` + `Field.user()` builder; the SQL/Mongo
  drivers treat `user` exactly like `lookup`; the engine resolves `$expand` for
  `user` fields and honours a new `defaultValue: 'current_user'` token (resolved
  app-side from the execution context, mirroring the `NOW()` convention); kanban
  group-by and symbolic seed references accept `user`; approvals enrich `user`
  references. The public API surface is unchanged (additive enum member).

### Patch Changes

- 98a1535: Fix: store SQLite `created_at`/`updated_at` in one canonical, timezone-explicit format (ADR-0074)

  The two SQLite write paths disagreed on the audit-timestamp format. INSERT fell
  back to the column default `CURRENT_TIMESTAMP` (`'YYYY-MM-DD HH:MM:SS'`) while
  UPDATE stamped `toISOString().replace('T',' ').replace('Z','')`
  (`'YYYY-MM-DD HH:MM:SS.mmm'`) — both **timezone-naive**, space-separated strings
  that `Date.parse` reads as _local_ time. On a non-UTC runtime a stored UTC
  wall-clock silently shifted by the host offset; e.g. the objectos kernel
  freshness probe compared a shifted `updated_at` against an absolute `builtAtMs`
  and never evicted (publishes/installs/config toggles didn't take effect until the
  LRU TTL expired).

  `create` / `bulkCreate` / `upsert` / `update` now stamp a single canonical
  ISO-8601 instant with an explicit `Z` (`new Date().toISOString()`) — matching the
  caller-stamped paths (`sys_metadata`, the service outboxes) and Postgres/MySQL's
  native `now()`. Because the stamp is applied app-side (not via the column
  default), **existing** tenant databases are fixed immediately, not just freshly
  created tables. `formatOutput` additionally repairs any legacy/raw zone-naive
  audit timestamp to the same format on read (idempotent), so old rows read back
  unambiguously without a data migration. `upsert` now treats `created_at` as
  insert-only — a conflicting merge never overwrites it.

  Postgres/MySQL are unaffected (they store a real zone-aware `TIMESTAMP`).

- bc22a89: Fix: present `Field.time` as a wall-clock time-of-day on read (SQLite)

  `Field.time` is a tz-naive time-of-day, not an instant (#2004). A
  `defaultValue: 'NOW()'` time column historically took the full SQLite
  `CURRENT_TIMESTAMP` default, so a defaulted/legacy row read back a full
  `'YYYY-MM-DD HH:MM:SS'` timestamp instead of a time-of-day.

  `formatOutput` now repairs a `Field.time` value to just its time portion
  (`toTimeOnly`): a legacy full timestamp — or a full ISO value that leaked into
  the column — is sliced to `HH:MM[:SS[.fff]]`, while a value already stored as a
  bare time-of-day is left untouched. This is a deliberately NARROW, read-only
  normalization with no write/filter counterpart, so it introduces no write/read
  asymmetry and preserves exact round-trips for bare time-of-day values (e.g. the
  field-zoo `f_time` guard). Runs for every dialect (a native TIME column already
  returns a time-of-day, so it is a no-op there).

  Completes the temporal-field read normalization alongside #2346: `datetime`
  folds to a canonical ISO-8601-`Z` instant, `date` to `YYYY-MM-DD`, and `time` to
  a wall-clock time-of-day.

- 8a7e9f1: Fix: canonical storage + presentation for user-declared `NOW()`-default temporal fields on SQLite (ADR-0074 follow-up)

  A user-declared `Field.datetime` (or `date`/`time`) with `defaultValue: 'NOW()'`
  took the `knex.fn.now()` → `CURRENT_TIMESTAMP` column default on SQLite, storing a
  **timezone-naive**, space-separated `'YYYY-MM-DD HH:MM:SS'` (no millis, no zone).
  `Date.parse` reads such a zone-less string as _local_ time, so the stored UTC
  wall-clock shifted by the host offset on a non-UTC runtime — the same class of bug
  ADR-0074 fixed for the builtin `created_at`/`updated_at` audit columns, but left
  scoped out for user fields. Worse, the **same** column mixed storage: an explicit
  JS `Date` is bound by better-sqlite3 as INTEGER epoch ms, while an omitted value
  took the naive TEXT default — so one column held both INTEGER ms and naive TEXT.

  This fix, SQLite-only:

  - **DDL default → canonical.** The `NOW()` default now emits a per-type canonical
    via `strftime`: datetime → ISO-8601 with explicit `Z`
    (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`, e.g. `2026-06-26T10:34:13.891Z`,
    matching `new Date().toISOString()`); date → `YYYY-MM-DD`; time → `HH:MM:SS.fff`
    time-of-day (not a full timestamp).
  - **Read → uniform instant.** `formatOutput` folds every `Field.datetime` storage
    form — INTEGER epoch ms, canonical ISO-`Z`, and legacy naive `CURRENT_TIMESTAMP`
    TEXT — to one canonical ISO-8601-`Z` instant (`normalizeSqliteDatetimeOutput`),
    interpreting a naive wall-clock as UTC. Idempotent on already-zone-explicit
    values; total on null/unparseable. This transparently repairs existing rows on
    read (a DDL default only governs newly-created columns), so no data migration is
    needed — mirroring the `Field.date`/numeric read-repairs already in place.

  Applied as DDL-default + read-normalization, NOT app-side write stamping (the
  inverse of ADR-0074's audit-column fix): the read path already repairs
  existing-table rows transparently, and an explicit `Date` is bound as INTEGER
  epoch ms regardless of any write stamp, so stamping wouldn't make on-disk storage
  uniform anyway — the INTEGER-vs-TEXT split is inherent to SQLite and resolved at
  the read boundary. This keeps the hot insert/upsert/bulk paths untouched.

  The analytics SQL-bucketing path (`strftime`, bypasses `formatOutput`) is
  unchanged: ISO-`Z` TEXT buckets identically to the old naive TEXT. Postgres/MySQL
  keep native `now()` (a real zone-aware `TIMESTAMP`) and are entirely unaffected.

  Generalizes ADR-0074's `repairNaiveUtcAuditTimestamp` by also folding the INTEGER
  epoch-ms storage form; the two read-repairs can be unified once both land.

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- 5ba52b0: fix(driver-sql): honor `tenancy.enabled:false` in driver org-scoping

  The driver auto-detects `organization_id` as a tenant-isolation column and, when
  the caller passes `DriverOptions.tenantId`, scopes reads/updates/deletes to that
  tenant (and injects the column on inserts). The implicit column-detection
  fallback ignored an explicit `tenancy.enabled === false`, so a platform-global
  object that opts out of tenancy but carries an optional `organization_id` FK
  (e.g. `sys_license`) was still org-scoped — an authenticated caller's active-org
  `tenantId` then hid every NULL-org / cross-org row. The opt-out is now honored in
  a single shared `computeTenantField()` used by both `initObjects` and
  `registerExternalObject` (which had drifted). Covers `TursoDriver` (extends
  `SqlDriver`). Genuine org-scoped objects are unaffected.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Minor Changes

- 517dad9: Schema drift detection + `os migrate` for non-additive metadata changes (#2186).

  The metadata→DB schema sync was additive-only: it created tables and added
  columns but never altered/dropped existing ones, so relaxing `required`,
  changing a type/length, or dropping a field silently diverged from an existing
  database. The physical column won at write time, surfacing a misleading
  `organization_id is required` 400 even though `/meta` reported the field
  optional.

  - **driver-sql** — the SQL driver now detects managed-schema drift (metadata is
    the source of truth) and categorises each divergence `safe` / `needs_confirm`
    / `destructive`. `initObjects` warns once per divergence with an actionable
    hint. A new opt-in `SqlDriverConfig.autoMigrate: 'safe'` auto-applies the
    _loosening_ subset (relax `NOT NULL`, widen varchar) so an existing dev DB
    self-heals on restart — never destructive, force-disabled under
    `NODE_ENV=production`. New public methods `detectManagedDrift()` /
    `applyMigrationEntries()`. SQLite reconciles via the official table-rebuild
    (copy → swap), preserving data; Postgres/MySQL alter in place.
  - **cli** — new `os migrate plan` (dry-run, categorised diff) and
    `os migrate apply` (`--allow-destructive` for drops/tightenings, confirm gate,
    `--json`). `os dev`/`serve` now pass `autoMigrate: 'safe'` in dev only.
  - **rest** — a `NOT NULL` violation that reaches the driver (metadata validation
    already passed) now carries a drift-aware `hint` pointing at `os migrate`,
    instead of only the misleading "field is required" message. The
    `VALIDATION_FAILED` / `fields` envelope is unchanged for back-compat.

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- 92db3e5: feat(driver-sql): honor `external.columnMap` on federated (external) objects (ADR-0015).

  When a federated object declares `external.columnMap` ({ remoteColumn -> localField }),
  the SQL driver now translates queries to the physical remote columns: WHERE and
  ORDER BY map local fields to remote columns (value coercion stays keyed by the local
  field), `formatOutput` renames remote-column keys back to local field names on read,
  and write payloads are key-remapped. Managed objects and external objects without a
  columnMap are unchanged (the resolver falls back to the existing per-site behavior).

- 2a1b16b: fix(ADR-0015): honor `external.remoteName` / `external.remoteSchema` on the federation read path.

  The query path previously resolved an external object's physical table from the
  object name, ignoring its `external` binding — so a federated object bound to a
  differently-named remote table failed with `no such table`, and ADR-0015's own
  `wh_order` → `mart.fact_orders` example was unqueryable. The SQL driver now
  resolves the remote table (`remoteName`, plus `remoteSchema` via `.withSchema()`
  on pg/mysql) and registers external objects' read-coercion metadata without DDL
  (`SqlDriver.registerExternalObject`, routed from the engine/plugin schema-sync).
  The managed path is unchanged. See ADR-0015 §18.

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Minor Changes

- 36138c7: feat(autonumber): date, {field} and per-scope counter reset for autonumber formats

  `autonumberFormat` previously only understood a single `{0000}` sequence slot —
  everything else was a fixed literal prefix on one global counter. Real MES/eHR
  record numbers need three more token classes, so the format is now tokenized by a
  shared pure renderer in `@objectstack/spec` (`parseAutonumberFormat` /
  `renderAutonumber`) that the engine fallback and the SQL driver both call, so they
  emit byte-identical numbers (#1603 parity):

  - **Date tokens** — `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` resolve the calendar
    day in the request's **business timezone** (`ExecutionContext.timezone`, ADR-0053;
    UTC fallback), threaded through the new `DriverOptions.timezone`.
  - **`{field}` interpolation** — `{section}{island_zone}{000}` substitutes record
    field values into the prefix.
  - **Per-scope counter reset** — the counter's scope is the rendered prefix _before_
    the sequence slot, so `AD{YYYYMMDD}{0000}` resets daily, `{section}{island_zone}{000}`
    numbers per group, and `{plan_no}{000}` numbers per parent — all from one
    mechanism, no separate reset config.

  Fixed-prefix formats like `CASE-{0000}` render an empty scope and keep their single
  global counter, so existing sequences are unchanged. The persistent
  `_objectstack_sequences` table is keyed by a `key_hash` (SHA-256 of
  `object, tenant_id, field, scope`) — a single 64-char primary key that keys every
  dialect uniformly, stays within MySQL's utf8mb4 index-length limit (four raw
  columns would not), and lets `scope` be a generous non-indexed column. Deployments
  with an older table (3-column, or an interim `scope` column) are migrated in place
  on first use, carrying existing counters to `scope=''`.

  Guardrails:

  - **Empty interpolated field is a hard error, not a silent mis-number.** A
    `{field}` token whose value is missing at create time would render to an empty
    prefix and collapse the record into the wrong counter scope. Both the SQL driver
    and the engine fallback now refuse to generate and throw a clear error naming the
    empty field (shared `missingFieldValues` helper).
  - **Build-time lint (`@objectstack/cli compile`).** `autonumber` formats are
    checked against the object's fields: a `{field}` token naming a non-existent
    field (or the autonumber field itself) **fails the build**; a token naming an
    _optional_ field emits an advisory warning to mark it `required: true`.
  - **Migration fails safe.** If a legacy table cannot be migrated to the `key_hash`
    shape, fixed-prefix sequences keep working via the legacy key and a per-scope
    write raises an actionable error instead of corrupting counters.
  - **Long `{field}` scopes are supported** (e.g. a long `{plan_no}`): the non-indexed
    `scope` column and hashed key remove the old varchar/PK length ceiling.

  Notes on inherent semantics (documented, not bugs):

  - The counter scope IS the rendered prefix. When two records' tokens render to the
    same prefix string (e.g. `{a}{b}` for `('AB','C')` and `('A','BC')`) they also
    render the same visible number, so they share one counter to stay unique — the
    remedy for genuinely-distinct groups is an unambiguous format (a delimiter
    literal between variable tokens).
  - The sequence pad width is a MINIMUM; past it the number grows (`{000}` →
    `1000`), it never wraps — matching mainstream autonumber semantics.

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- db02bd5: Fix dashboard time-series charts / "last N months" KPIs that filter or group by a `Field.datetime` column silently returning "No rows".

  The analytics `NativeSQLStrategy` compiles dashboard relative-date tokens (`{12_months_ago}`, `{today}`, …) to ISO date strings and binds them directly into raw SQL, bypassing the driver's own filter coercion. Under better-sqlite3 a `Field.datetime` column is stored as an INTEGER epoch (ms), so `assessed_at >= '2025-06-18'` became a TEXT-vs-INTEGER affinity compare that is always false — an empty result even though the rows exist. `Field.date` columns store ISO TEXT and were unaffected.

  The strategy now coerces a temporal comparand to the column's on-disk storage form via a new optional `StrategyContext.coerceTemporalFilterValue` hook, wired to the driver's public `SqlDriver.temporalFilterValue` (the single source of truth for the storage convention). Coercion is dialect-correct: SQLite `Field.datetime` → epoch ms; `Field.date` text and native-timestamp dialects (Postgres/MySQL) are left unchanged, so Postgres is never handed an epoch integer. Applied to `gte`/`lte`/`gt`/`lt`/`equals`, `in`/`notIn`, and the `dateRange`/timeDimension `BETWEEN` path.

- d9508d1: fix(driver-sql): make numeric-scalar type fidelity self-heal on legacy SQLite columns

  The #2025 fix mapped `rating`/`slider`/`progress` to numeric columns, but SQLite never alters a column's type in place and the schema reconciler only adds missing columns — so a column created before that fix keeps its TEXT affinity and would still read back `'4'` instead of `4` forever.

  A read-side numeric coercion (the new `numericFields` registry, single-sourced from `NUMERIC_SCALAR_TYPES`) now coerces numeric-looking stored strings back to numbers on read, mirroring how `dateFields` already repairs legacy timestamp-typed `Field.date` rows. The fidelity no longer depends on column affinity alone; `null` and genuinely non-numeric legacy values are left intact rather than turned into `0`/`NaN`.

- 1d352d3: fix(driver-sql): round-trip rating/slider/toggle/progress with type fidelity

  `rating`/`slider`/`toggle`/`progress` had no case in the DDL column-type switch, so they fell to `default → table.string` (TEXT affinity). SQLite then coerced the written value to a string — `rating: 4` read back `'4'`, `toggle: true` read back `'1'` — so the value persisted but the JS type leaked on read. On a low-code platform where field types are author-driven, a field that silently returns the wrong type is a runtime-fidelity trap the static gates and value-loss tests don't catch.

  - `rating`/`slider`/`progress` now map to a REAL (numeric) column.
  - `toggle` maps to a boolean column and is registered in the boolean read-coercion path, so stored `1`/`0` come back as real JS booleans.
  - The object-valued `record`/`video`/`audio` types are folded into the shared `JSON_COLUMN_TYPES` source, and the DDL `default` case now derives JSON-vs-string from that set, so the column-type switch and `isJsonField` (the read-side deserializer) can no longer drift.

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

### Minor Changes

- bfa3102: fix: array-valued field types persist, and `Field.time` accepts time-of-day — two field-type runtime gaps found driving the showcase field-zoo (which had no seed data, so neither was ever exercised).

  **Array/object fields broke every write (driver-sql).** `multiselect` / `checkboxes` / `tags` / `repeater` / `vector` were absent from the SQL driver's JSON-field classification, so their array values reached the better-sqlite3 binder un-serialized and threw _"SQLite3 can only bind numbers, strings, bigints, buffers, and null"_ — a 500 on insert/update for common field types (even `task.labels` on a normal object). The DDL column-type switch and `isJsonField` had drifted into two separate lists; they now share one `JSON_COLUMN_TYPES` source that includes the array/object types, so these columns are created as JSON and round-trip as arrays/objects. A `formatInput` safety net additionally serializes any stray array/object value so an unclassified field degrades to a stored string instead of crashing.

  **`Field.time` rejected every valid value (objectql).** The validator reused the date/datetime branch (`Date.parse`), which is `NaN` for any bare time string — so a `time` field could never accept `14:30` or `09:05:30`. `time` now validates a time-of-day (`HH:MM` / `HH:MM:SS`, optional fractional seconds and `Z`/offset) and still accepts a full ISO datetime; `date`/`datetime` are unchanged.

  Verified live on app-showcase: the full field-zoo specimen (all input-able field types) now persists and round-trips. Regression tests added for both.

### Patch Changes

- 796f0d6: fix(driver-sql): `Field.date` is now stored and returned as a tz-naive `YYYY-MM-DD` calendar day (ADR-0053 Phase 1)

  A `Field.date` ("close date", "due date", "birthday") is semantically a **timezone-naive calendar day**, but the SQL driver was treating it as an _instant_: `formatInput` wrote the value verbatim (keeping any time component, so `dev.db` held `close_date = "2026-07-15T17:24:56.533Z"`), while the filter layer (`coerceFilterValue`) already normalized the comparand to date-only `YYYY-MM-DD`. That write/filter asymmetry meant a date-equality filter — `close_date == '2026-07-15'`, `expires_on: { $in: [...] }`, or a `daysFromNow(n)`-style comparand — compared `"2026-07-15T17:24Z"` against `"2026-07-15"` and **silently matched nothing**.

  This patch aligns the write/read boundary with the date-only contract the filter already enforced:

  - **Write** (`formatInput`): every `Field.date` value (a JS `Date`, a full-ISO string, or an already date-only string) collapses to `YYYY-MM-DD` before insert/update. A `Date` collapses to its UTC calendar day, matching `coerceFilterValue`.
  - **Read** (`formatOutput`): `Field.date` values are returned as `YYYY-MM-DD`, slicing any stored time component. This transparently repairs legacy rows that were written as a full timestamp, so date-equality works **without a data migration**. Read normalization now runs on the `find` path for every dialect (previously only `findOne`), matching the new behaviour.
  - The truncation logic is shared by the filter, write and read paths via a single `toDateOnly` helper, so all three agree on what a date _is_.

  `Field.datetime` is **unchanged** — it keeps full-instant (UTC millisecond) semantics.

  Out of scope (ADR-0053 Phase 2): timezone-aware `today()`/`daysFromNow()`/`daysAgo()`, an org/user reference timezone, and `datetime` render-time TZ. See ADR-0053 and issue #1928.

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- b678d8c: fix(driver-sql): an unknown `$select` column must not zero the result set

  `find()` swallowed any "no such column" error into an empty array. A projected
  `$select` naming a column the table lacks (e.g. a generic list view
  auto-requesting `status`/`due_date`/`image` on an object without them) then made
  the WHOLE query return zero rows — reading to the UI as "no records exist" while
  the data was actually there: a silent data-loss footgun.

  When the failure comes from the projection, retry once with `SELECT *` so the
  real rows still come back (the phantom field is simply absent from each row).
  Non-projection errors (unknown table, etc.) still surface as before. This driver
  backstop holds even when the engine's unknown-field filter cannot fire because
  the object's schema is not populated in the registry (notably the cloud
  multi-tenant runtime).

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Minor Changes

- b990b89: fix(autonumber): one owner for autonumber generation — the persistent driver sequence (#1603)

  Autonumber values were generated in TWO places: the SQL driver's persistent,
  atomic `_objectstack_sequences` table AND a non-persistent in-memory counter in
  the ObjectQL engine. Because the engine pre-filled the field BEFORE calling the
  driver, the driver always saw a value already set and skipped — so the
  persistent sequence was effectively dead code, and a multi-instance / post-restart
  deployment could mint duplicate numbers from the in-memory counter.

  This makes generation single-owner:

  - **`@objectstack/spec`** — `DriverCapabilities` gains an optional `autonumber`
    flag: "driver natively generates persistent autonumber/sequence values".

  - **`@objectstack/driver-sql`** — advertises `supports.autonumber = true`.
    `bulkCreate()` now fills autonumber fields too (previously only `create()` /
    `upsert()` did), so bulk inserts also draw from the persistent sequence.
    Field parsing now honors either the spec-canonical `autonumberFormat` key OR
    the `format` shorthand (both appear in metadata).

  - **`@objectstack/objectql`** — when the driver advertises native autonumber
    support, the engine NO LONGER pre-fills (it defers entirely to the persistent
    driver sequence as the single source of truth). For drivers without native
    support (memory, mongodb) the in-memory fallback is unchanged. The fallback
    also now reads either `autonumberFormat` or `format`. Record-validation
    exempts `autonumber` fields from the `required` check — the value is
    runtime-owned and assigned after validation, so a required record number is
    never rejected as "missing".

  No metadata changes required. Existing data is respected: the driver bootstraps
  each sequence from the current max numeric tail on first use.

### Patch Changes

- 1e8b680: fix(security): close four P0 launch-readiness findings

  - **plugin-auth (P0-1):** `generateSecret()` now throws (fails boot) when no
    `OS_AUTH_SECRET` is set and `NODE_ENV==='production'`, instead of silently
    falling back to a predictable `dev-secret-<timestamp>` (session forgery). The
    dev/test fallback is unchanged.
  - **plugin-security (P0-2):** the permission-resolution `catch` now **fails
    closed** — it logs at ERROR and throws `PermissionDeniedError` rather than
    `return next()`. A degraded metadata service can no longer let every
    authenticated request bypass RBAC/RLS. System operations still bypass as before.
  - **driver-sql (P0-3):** the `contains` / `$contains` operator now escapes LIKE
    metacharacters (`%` / `_` / `\`) in the user value and binds an explicit
    `ESCAPE '\'`, so a value of `%` matches literally instead of every row
    (filter bypass). Correct across SQLite/MySQL/Postgres.
  - **driver-mongodb (P0-4):** the field-operator translator now rejects unknown
    `$`-operators instead of passing them through, blocking `$where` / `$function`
    / `$expr` (server-side JS execution / query-intent bypass). All legitimate
    ObjectQL operators remain allowlisted.

  +12 regression tests across the four packages.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 24c9013: fix(driver-sql): materialize declared object-level indexes (#1459)

  The SQL driver synced columns and field-level `unique`, but silently dropped
  object-level declared `indexes` (`ObjectSchema.indexes: [{ fields, unique }]`).
  As a result several documented multi-column UNIQUE / dedup guarantees were
  never enforced at the DB level — a fresh `dev --fresh` sqlite DB showed only
  primary-key autoindexes.

  `initObjects` now materializes declared indexes (`syncDeclaredIndexes`) after
  the table is created/altered:

  - single- and multi-column indexes, including `UNIQUE`
  - NULL-distinct semantics (the cross-dialect default), so multiple NULL rows
    stay insertable while non-NULL duplicates are rejected — matching the
    convergence-on-conflict pattern the messaging pipeline relies on
  - idempotent: deterministic, length-bounded index names + per-dialect
    existing-index introspection (sqlite/pg/mysql); "already exists" races are
    absorbed
  - indexes referencing a non-materialized (virtual `formula`) column are skipped
    with a warning instead of failing sync

  The `indexes` driver capability flag is now `true`.

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 1.

  Adds the spec foundation and the DDL gate for federating mature external
  databases without ObjectStack ever mutating their schema:

  - `Datasource.schemaMode` (`managed` | `external` | `validate-only`) and
    `Datasource.external` settings, with a cross-field invariant.
  - `Object.external` binding (remote table/schema, writability, column map).
  - Shared error contract: `ExternalSchemaMismatchError`,
    `ExternalWriteForbiddenError`, `ExternalSchemaModeViolationError`
    (stable `code`s) + structured `SchemaDiffEntry` rendering.
  - `driver-sql` DDL gate: schema-mutating DDL (`initObjects`/`syncSchema`/
    `dropTable`) is rejected when `schemaMode !== 'managed'`.

  All changes are additive and backward-compatible (`schemaMode` defaults to
  `'managed'`).

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- 4944f3a: Promote native database client packages so npm consumers can boot without manual installs.

  - `better-sqlite3` is now an `optionalDependency` (prebuilt binaries cover the common case), so `npx @objectstack/cli start` boots a default SQLite database out-of-the-box.
  - `pg`, `mysql2`, `sqlite3`, and `tedious` are declared as optional `peerDependencies` (`peerDependenciesMeta.optional = true`), removing install warnings while keeping the loader-on-demand pattern.

  Fixes: `Knex: Cannot find module 'better-sqlite3'` on fresh `npm install @objectstack/cli` followed by `objectstack start`.

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Minor Changes

- 0cc0374: feat(driver-sql): tenant-isolated auto_number sequences backed by a persistent counter table

  **Breaking nothing; new behaviour is opt-in via object schema.**

  The SQL driver now generates auto_number / autonumber field values via a
  dedicated `_objectstack_sequences` table keyed by
  `(object, tenant_id, field)` instead of scanning the data table for the
  current MAX on every insert.

  Highlights:

  - **Tenant isolation.** Objects with an `organization_id` field get a
    separate counter per organization. Two tenants creating contracts at
    the same time both legitimately observe `CTR-0001`, `CTR-0002`, … in
    their own namespaces — they no longer interleave or skip numbers.
  - **Tenant resolution.** Source order: `row[organization_id]` →
    `DriverOptions.tenantId` → `__global__` sentinel for org-less objects
    (e.g. setup-side singletons share one counter).
  - **Bootstrap from existing data.** On the first reservation in a new
    `(object, tenant, field)` tuple, the driver seeds `last_value` from the
    current per-tenant MAX so legacy/seeded records keep their position
    and downstream inserts pick up monotonically (gaps are tolerated).
  - **Atomic increment.** Each reservation runs in a transaction with
    `SELECT … FOR UPDATE` (where the dialect supports it) and a single
    `UPDATE` of `last_value`. Tested with 25 concurrent inserts in one
    tenant producing 25 distinct sequence values.
  - **Caller overrides honoured.** A row that already has an explicit
    value for the auto_number field is left untouched, and the sequence
    bootstrap respects that value so future reservations advance past it.
  - **Dual spelling.** Both `type: 'auto_number'` (snake) and
    `type: 'autonumber'` (the spec factory output) are recognised.

  Migration notes:

  - The first time the driver handles an auto_number insert, it creates
    the `_objectstack_sequences` table automatically — no manual DDL.
  - Pre-existing data is not renumbered. Gaps introduced by older
    cross-tenant logic (where a tenant's number could "jump" because it
    inherited another tenant's MAX) remain in place; subsequent inserts
    continue from `MAX + 1` in the affected tenant.

- 5b878d9: Generate `auto_number` / `autonumber` field values on insert. The driver
  parses the field's `format` template (e.g. `CTR-{0000}`) to extract the
  prefix and pad-width, then scans existing rows with the same prefix and
  emits `prefix + padded(maxN + 1)` for any row that omits the field.

  Note: per-call MAX+1 — not atomic across concurrent writers. Fine for
  seed-data and low-write demo loads; production deployments should layer
  a dedicated sequence table.

- f0b3972: **Driver-level tenant isolation for objects with `organization_id`.**

  `SqlDriver` now auto-applies a `WHERE organization_id = :tenantId` predicate on every read/update/delete and auto-injects the column on insert when the caller passes `options.tenantId` and the object schema declares an `organization_id` field. `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `count` and `aggregate` are all scoped.

  ObjectQL's engine now threads `ExecutionContext.tenantId` into the driver options for every CRUD entry point (including `expandRelatedRecords`), so a tenant-scoped session can no longer cross tenants — even through lookup expansion or count fallbacks.

  Backward compatible: callers that omit `tenantId` (system tasks, seed scripts) keep getting unscoped behaviour. Explicit `organization_id` on an insert row always wins over the contextual `tenantId` so admin tooling can still target a specific tenant.

  13 new tests in `sql-driver-tenant-scope.test.ts` verify cross-tenant find/findOne/update/delete/count/bulkCreate/updateMany/deleteMany isolation, the unscoped admin path, and that global objects (no `organization_id`) are not scoped.

- 0e63f2f: **Declarative tenant scoping + audit warn for missing tenantId.**

  `SqlDriver` now reads `obj.tenancy.tenantField` first when picking the tenant column for an object, falling back to the implicit `organization_id` detection so legacy objects keep working without a spec migration. Set `tenancy: { enabled: true, strategy: 'shared', tenantField: 'workspace_id' }` on any object to use a custom column.

  Writes (`create`, `update`, `delete`, `bulkCreate`, `bulkDelete`, `updateMany`, `deleteMany`, `upsert`) that target a tenant-scoped object **without** `options.tenantId` now emit one `[tenant-audit]` warning per `{object}:{op}` so missing-context bugs surface in CI/logs instead of silently writing globally. The engine auto-silences when `ExecutionContext.isSystem === true` (boot-time seeds, kernel mirrors). Callers can opt out per-call with `options.bypassTenantAudit = true` or globally with `OS_TENANT_AUDIT=0`.

  Driver README now documents the full scope/bypass matrix and the audit warning.

  Three new tests cover the declared-tenant-field path, the audit throttle, and the bypass flag.

### Patch Changes

- 5683206: Document the tenant-isolation bypass on raw `execute()` (both `SqlDriver.execute()` and `engine.execute()`). The behaviour is unchanged — `execute()` has always passed commands through verbatim — but the JSDoc now spells out the security contract so callers know they must inline `WHERE organization_id = ?` themselves or restrict raw execution to genuinely global statements (migrations, control-plane tables).
- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 3.3.2

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
