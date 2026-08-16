---
"@objectstack/types": patch
---

fix(types): teach the internal-leak predicate MySQL's three error templates (#8739)

`looksLikeInternalErrorLeak` decides whether a message is a driver dump that
must not reach an API client. It is applied at three HTTP boundaries
(`@objectstack/rest`'s `mapDataError`, `@objectstack/runtime`'s
dispatcher-plugin and endpoint-executor, the hono adapter) and by
`@objectstack/objectql`'s log redactor. Its dialect list covered the SQLite
family and Postgres; on a MySQL deployment it returned `false` for every one of
these conditions — **silent, not clearing**.

Under the maintainer's 2026-08-15 ruling on #8739, **MySQL is a supported
deployment target**, not merely a tested dialect — the answer already implied by
what is published (`OS_DATABASE_DRIVER=mysql` as a documented deployment knob,
`MysqlConfig` as authorable datasource config, per-field MySQL DDL in
`types.mdx`) and by a required CI check that stands up a live `mysql:8.0`. A
supported target's driver text reaches those boundaries in production, so its
templates belong in the list.

**Now recognised** — one per condition the other two dialects were already
covered for, each anchored on MySQL's own errmsg template rather than on a bare
substring:

- `Table 'app.t' doesn't exist` (ER_NO_SUCH_TABLE 1146). MySQL's contracted
  spelling quotes `db.table` as one identifier, so the Postgres
  `relation "t" does not exist` limb could never reach it.
- `Unknown column 'c' in 'field list'` (ER_BAD_FIELD_ERROR 1054). Both quoted
  parts are required; the second is MySQL's clause name (`field list`,
  `where clause`, `order clause`, `on clause`), and it is what distinguishes the
  driver's template from a sentence that merely calls a column unknown.
- `Duplicate entry 'x' for key 'i'` (ER_DUP_ENTRY 1062). The `for key` tail plus
  a quoted index is the anchor. This is the one MySQL template whose text embeds
  a **caller's value** rather than an identifier — SQLite's
  `UNIQUE constraint failed: t.c` and Postgres' `violates unique constraint "…"`
  both name only an index — which is why closing this gap was worth a behaviour
  change rather than another comment.

**Deliberately still NOT recognised**, so the boundary of the change is on the
record rather than inferred:

- **MySQL's ACL family** — `Access denied for user 'u'@'h' to database 'd'`
  (1044), `SELECT command denied to user … for table 't'` (1142) — the
  counterpart of the Postgres `permission denied for table` limb. Nothing in
  this repo has raised one off a live server, and the standing rule in this
  neighbourhood (`unique-violation.ts`) is that a dialect's spelling is added
  once it has been MEASURED off a thrown error, never from a reading of the
  manual. `Access denied` also collides with this platform's own security prose
  (`[Security] Access denied: …`), so a guessed pattern here would over-match —
  and over-matching suppresses diagnostics an operator needs.
- **MSSQL and Oracle** — `Invalid object name 'sys_metadata'.`,
  `ORA-00942: table or view does not exist` still return `false`.
- **Prose that shares the keywords without the driver's anchoring** — an import
  summary saying `duplicate entry in the uploaded file`, a mapping message
  saying `Unknown column in the uploaded CSV header`, `The table you selected
  does not exist`. Pinned as negative cases, because a phrasing list that says
  "leak" too often replaces real answers with `Internal server error`.

**The `false`-means-UNCOVERED rule survives the change and keeps a live
subject.** A `false` here has never meant the text is safe, only that the
predicate never learned that dialect — the reading a reviewer on PR #8737 got
wrong while sizing a disclosure residual, which is what produced this card. The
four `toBe(false)` pins PR #8824 planted as a tripwire for this exact moment
went red as designed and are rewritten, not deleted: the same three measured
messages now assert `true`, so a future change that silently drops MySQL
coverage fails there, and a second block keeps the original `false`-means-
uncovered shape pointed at MSSQL and Oracle. `declaresServerFault` remains the
phrasing-independent answer.

**No status mapping moves.** `@objectstack/rest` answers the 409 conflict
question with `isUniqueViolationError`, above and independently of this
predicate (#6250), so a MySQL duplicate-entry error is still `409
UNIQUE_VIOLATION` and a MySQL unknown-column error is still `400 INVALID_FIELD`
— both decided before the leak branch is reached. The log redactor is unchanged
too: a bare MySQL diagnostic carries no knex ` - ` separator, so there is no
statement to cut. Measured across the predicate's full consumer set — types,
objectql, rest, runtime, metadata-protocol, hono, service-package,
service-analytics — the only verdicts that moved are the two that measure this
predicate directly.

No live MySQL deployment leaking through these boundaries was measured; this
closes a gap in what the boundary recognises, and the card is explicit that no
leak was demonstrated.
