---
"@objectstack/objectql": patch
---

fix(objectql): stop reporting "the table does not exist yet" as an ERROR with a stack trace (#13273)

`ObjectQL.find` logged every read failure identically: `ERROR Find operation
failed`, carrying the driver's fault as a stack. That merged two different
facts — **"this table has not been created yet"** and **"this read failed"** —
onto one channel, at the level reserved for the second.

Measured on `os migrate plan --database-url file:<an unmigrated database>`,
which is the ordinary first run and exactly the run the command exists to
describe: **five** ERROR records with full stack traces, out of a command that
exits 0 and prints a correct plan. Every one of them is a boot-path probe whose
caller already treats a missing table as a normal answer and says so in its own
code — `readMigrationFlagVerified` (`sys_migration`),
`ObjectStoreActionActivationStore.probe` (`sys_metadata_activation`),
`readAuthoredTranslationLayer` and `ObjectQLPlugin`'s authored-hook /
authored-action re-syncs (`sys_metadata`, which report `authoredRows: 0` and
carry on). An `error` channel that fires on a routine state is what trains
operators to skim `error`.

**What changed:** the read path now picks the level from the CAUSE. A failure
that positively identifies as "relation does not exist" — asked through the
shared `isMissingTableError` predicate (`@objectstack/metadata/errors`), never a
hand-rolled code test — is logged at `debug` with a
`reason: 'table-not-provisioned'` meta and no stack. Everything else is
unchanged: `error`, with the Error and its stack.

**⛔ What did not change**, and is pinned:

- **The throw.** Both branches rethrow the driver's envelope byte-identically,
  so no caller's control flow, `catch` or error envelope moves. This is a log
  level and nothing else.
- **Every genuinely failed read.** A connection drop, a timeout, a permission
  denial, an unclassified fault — and, through the predicate's `excludes`,
  Postgres' `column "x" of relation "y" does not exist`, which contains a legal
  missing-table phrase but is a column fault on a table that exists — all stay
  loud. Measured end to end on the same command: against a database whose
  `sys_metadata` exists but lacks the column being filtered on, three ERROR
  records with stacks remain in the same run in which the two still-absent
  tables stay quiet; against a file that is not a database at all
  (`SQLITE_NOTADB`), all five stay loud and the command exits 1.
- **The driver's own refusal envelope.** `[sql-driver] DATABASE_ERROR — the
  backend refused a read on '<table>' … no such table: <table>` still goes to
  `warn` on every one of these reads. It is deliberately the surviving loud
  half: the class remains visible to an operator, without a duplicate and
  without a stack.
- **The write verbs.** `insert` / `update` / `delete` keep their unconditional
  `error` — a write to a table that does not exist is not a normal answer for
  any caller, and nothing landed.

User-visible: `os migrate plan` (and any first boot against an unprovisioned
database) no longer prints these stack traces. Fixtures that captured this frame
on the `error` channel should read `debug` as well; the shared
`expected-read-refusal-noise` helper in `@objectstack/runtime`'s test tree
already does.
