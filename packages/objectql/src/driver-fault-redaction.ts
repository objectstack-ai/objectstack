// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8682] Keep the CALLER'S VALUES out of the server log when a driver-level
 * write fault is logged.
 *
 * ## The exposure this closes
 *
 * A SQL driver builds its error message by prefixing the offending statement —
 * fully bound, values inlined — to the database's own diagnostic. knex's shape
 * is `<statement> - <native message>`. The engine's write paths log that error,
 * and `Logger` serializes exactly two of its fields (`message`, `stack`), so a
 * single mistyped field name in a client request wrote an entire row's values
 * to disk at ERROR level, twice:
 *
 * ```
 * ERROR Insert operation failed {"object":"crm_account","error":{"message":
 *   "insert into `crm_account` (`account_number`, …, `zzz_nonexistent_field`)
 *    values ('ACC-000011', …, 'SENSITIVE-CANARY-9f3a2b') returning *
 *    - table crm_account has no column named zzz_nonexistent_field", "stack":
 *   "SqliteError: insert into `crm_account` (…) values (…) returning * - …"}}
 * ```
 *
 * Measured with planted canaries: the row's values, the organization id and
 * the acting user id all landed in the log, and `stack` re-opened with the
 * whole statement a second time — so redacting `message` alone would have
 * moved the leak rather than closed it. Both fields are rebuilt here.
 *
 * ## What is KEPT, deliberately
 *
 * The driver's own diagnostic — the tail — is the half that names the failing
 * column and the condition (`table crm_account has no column named
 * zzz_nonexistent_field`, `NOT NULL constraint failed: sys_team.name`). It is
 * kept, and the log site keeps the `object` it already carried. ⛔ The
 * remedy for this exposure is NOT to lower the level or drop the entry: a
 * driver-level fault that logs nothing is a fault nobody can debug, which is
 * strictly worse than one logged too loudly. This narrows WHAT is written; the
 * level, the message and the entry are untouched.
 *
 * ## [#8823] …but "the tail names identifiers" is not true of every dialect
 *
 * The paragraph above was written with a premise attached: that whatever the
 * database prints after the separator names IDENTIFIERS — a column, a table, a
 * constraint. That premise was checked against SQLite and Postgres, and it is
 * false on MySQL for one family. MySQL's `ER_DUP_ENTRY` (1062) puts the
 * conflicting value in the diagnostic itself rather than in the statement:
 *
 * ```
 * mysql  unknown column   => "Unknown column 'zzz' in 'field list' […]"
 * mysql  duplicate entry  => "Duplicate entry 'acme@example.com' for key 'crm_account.email' […]"
 * sqlite unique violation => "UNIQUE constraint failed: crm_account.email […]"
 * pg     unique violation => "duplicate key value violates unique constraint "crm_account_email_key" […]"
 * ```
 *
 * Three keep an identifier; the second keeps a caller's value. Measured through
 * this function, not predicted — and re-measured byte-identical after #9030
 * taught the shared leak predicate this phrasing, which moves the VERDICT but
 * not the cut.
 *
 * Postgres is not saved by the cut here — it is saved by an unrelated fact:
 * its conflicting value lives on `error.detail`, a field `Logger` never
 * serializes (it writes `message` and `stack`, nothing else). That is a
 * coincidence, not a defence, and nothing below makes `detail` reachable.
 *
 * So the tail is kept, minus the spans a dialect's own template documents as a
 * VALUE — see {@link redactDiagnosticValues}. Identifier-bearing tails are
 * untouched, which is the property #8682 paid for on purpose: MySQL's
 * `for key '…'` names an INDEX (`uniqueViolationColumn` in
 * `@objectstack/types` refuses to read a column out of it for exactly that
 * reason), and an operator debugging a duplicate needs that index name.
 *
 * ⛔ This is a server LOG. The rethrown error is untouched and every HTTP
 * boundary is unaffected.
 *
 * ## [#9160] The list is now MEASURED, and there is a way to notice a gap
 *
 * #8823 left one entry and no instrument: nothing measured whether a diagnostic
 * a driver produced carried a value, so the next entry needed the same accident
 * that found the first. `sql-driver-diagnostic-value-probe.test.ts` is that
 * instrument. It plants a canary value, raises each candidate family against
 * the live MySQL 8.0 / PostgreSQL 16 services the `Temporal Conformance (live
 * PG + MySQL)` job stands up, and asserts of EVERY family — value-bearing or
 * not — whether the canary reaches `error.message`. A family that starts
 * inlining a value it did not inline before is a named red, not a silent leak.
 *
 * What it measured (MySQL 8.0.46, PostgreSQL 16.13), verbatim:
 *
 * ```
 * mysql 1062  Duplicate entry 'CANARY-abc' for key 'probe.uq'              VALUE
 * mysql 1366  Incorrect integer value: 'CANARY-abc' for column 'age' at row 1   VALUE
 * mysql 1292  Incorrect datetime value: 'CANARY' for column 'when_at' at row 1  VALUE
 * mysql 1264  Out of range value for column 'age' at row 1                 identifier only
 * mysql 1406  Data too long for column 'label' at row 1                    identifier only
 * mysql 1054  Unknown column 'zzz_nonexistent_field' in 'field list'        identifier only
 * pg    22P02 invalid input syntax for type integer: "CANARY-abc"           VALUE
 * pg    22007 invalid input syntax for type timestamp with time zone: "…"   VALUE
 * pg    22003 value "99999999999" is out of range for type integer          VALUE
 * pg    23505 duplicate key value violates unique constraint "…_key"        identifier only¹
 * pg    23502 null value in column "id" of relation "t" violates not-null…  identifier only¹
 * pg    22001 value too long for type character varying(20)                 identifier only
 * ```
 *
 * ¹ on `error.message`. Both put the caller's row on `error.detail`, which
 * `ObjectLogger.write` does not serialize — the coincidence #8823 recorded, and
 * it is still only a coincidence. **The three Postgres families marked VALUE put
 * the caller's value on `message`, the field that IS serialized**, so nothing
 * covers them but the entries below. That was the open question #9160 asked and
 * the answer is the one the card feared.
 *
 * ## [#9275] The residue #9160 left, and the amendment to the cut that closes it
 *
 * #9160 recorded a residue it did not close: when the caller's value itself
 * contains ` - `, the statement cut lands INSIDE that value and eats the
 * template head. Families with a right anchor recover via their `tail` pattern,
 * but the ones whose value runs to end of message have nothing to recover from
 * and leave a suffix of the caller's value standing in the log. Re-measured at
 * HEAD on the same live servers, canary `SENSITIVE-CANARY-9275 - 2026 - Q3`:
 *
 * ```
 * raised:  insert into "t" ("age") values ($1)
 *            - invalid input syntax for type integer: "…CANARY… - 2026 - Q3"
 * logged:  Q3" [statement and bound values redacted]     ← `Q3` is caller data
 * ```
 *
 * Closing it needs the cut itself to become template-aware, which is an
 * amendment to #8682's contract rather than another row in a list. **Ruled by
 * the maintainer on 2026-08-17 (#9275): take it, with the trade stated.** See
 * the section below.
 *
 * The re-measurement also moved the COUNT. #9160 named two families here; three
 * leave a value suffix, and the third wants the other remedy:
 *
 * ```
 * pg 22P02/22007  value runs to end of message   → head-anchored cut (below)
 * mysql 1292      value runs to end of message   → head-anchored cut (below)
 * pg 22003        value "…" is out of range …    → `tail`, the #8823 mechanism
 * ```
 *
 * `22003` was assumed unreachable on the reasoning that its value slot holds a
 * number, which cannot contain ` - `. Measured through the driver's own bind
 * path, that is false: Postgres' integer parser detects the OVERFLOW before it
 * rejects the trailing junk, so it echoes the whole caller string back —
 * `insert({ age: '99999999999 - 2026 - Q3' })` prints `value "99999999999 -
 * 2026 - Q3" is out of range for type integer` and logged `Q3` as caller data.
 * It has a right anchor, so it takes a `tail` row and needs no cut change.
 *
 * ## Why the cut is at the separator, and not at a statement keyword
 *
 * "Is this a driver dump?" already has ONE owner in this repo —
 * {@link looksLikeInternalErrorLeak} in `@objectstack/types`, applied by both
 * HTTP boundaries and tested from both directions (it catches dialect codes,
 * bare statements and constraint dumps; it deliberately does NOT fire on
 * ordinary business or validation prose). Re-deriving a second statement-head
 * keyword list here is exactly the drift that module exists to prevent, so this
 * asks it the verdict and adds only the one thing it does not answer: WHERE the
 * statement ends.
 *
 * That answer is structural, not lexical. Every value a driver inlines sits in
 * the statement, and the statement always comes FIRST — so the last ` - ` in a
 * message the shared predicate has already called a driver dump separates the
 * part that may carry values from the part that may not. The cut takes the
 * LAST separator rather than the first on purpose: a bound value may itself
 * contain ` - ` (`'2026 - Q3 plan'`), and cutting at the first would leave a
 * fragment of that value standing in the tail. Cutting at the last can only
 * ever discard MORE than necessary, which is the safe direction — and when a
 * native message legitimately contains ` - `, what is lost is a prefix of the
 * diagnostic, never the failing identifier the database names at the end.
 *
 * ### [#9275] …except when a KNOWN head says where the diagnostic really began
 *
 * "Discard more is safe" holds for the STATEMENT half, and it is exactly wrong
 * for the DIAGNOSTIC half. When the value the database inlined into its own
 * message contains ` - `, the last separator sits inside that value, so the cut
 * discards the template head and keeps the value's suffix — it discards the
 * half that could not leak and keeps the half that does.
 *
 * So the cut asks one more question first: does a separator in this message
 * stand immediately before a diagnostic head this file has MEASURED (see
 * `head` in {@link VALUE_BEARING_TEMPLATES})? If one does, that separator is
 * the true one whatever its position, the head survives, and the value after it
 * — ` - ` and all — is dropped whole by the template that owns it.
 *
 * ⛔ This DOES mean a template is matched before the cut, which the note here
 * previously forbade in terms: "a bound value can contain anything, this file's
 * own template included, and matching before the cut would let a value in the
 * STATEMENT steer what survives". That prohibition is not deleted, it is
 * AMENDED, and the trade it was protecting is now stated instead of avoided.
 *
 * The steering is real and it is BOUNDED TO OVER-REDACTION. A hostile value
 * that spells a known head makes the cut land inside the statement, at that
 * head — and two properties make what follows unleakable rather than exposed:
 *
 *  1. only a template whose value runs to END OF MESSAGE may declare a `head`
 *     (the invariant on {@link ValueBearingTemplate.head}), so whatever follows
 *     the head-anchored cut is consumed whole by that template's own `whole`
 *     pattern — including the rest of the statement it cut into;
 *  2. the LAST such head wins, not the first. A value that mimics a head is
 *     therefore cut at the mimic, never before it, so no part of the value can
 *     survive by hiding behind its own decoy. Taking the first would leak;
 *     this ordering is load-bearing and is pinned by its own case.
 *
 * What a hostile value CAN do is suppress a real diagnostic: craft `- invalid
 * input syntax for type integer: "` into a value and the operator reads that
 * head plus `[value redacted]` instead of the `Unknown column …` the server
 * actually replied. That costs debuggability on a crafted input and is the
 * price of closing a leak on ordinary ones. **Ruled deliberately by the
 * maintainer on 2026-08-17 (#9275)**, against the alternatives of inferring
 * from unbalanced quotes (a new inference rule, over-match risk) and of
 * accepting the residue as best-effort (caller data at ERROR level, which is
 * the thing this neighbourhood exists to prevent).
 *
 * ⛔ The escape hatch this is NOT: a head is not a licence to cut anywhere a
 * template appears. No head may be declared for a template whose diagnostic
 * continues past the value — cutting into a statement on such a head would keep
 * whatever follows the template's right anchor, which is statement, which is
 * values. That is the one way this amendment could leak, and the invariant
 * above is what forecloses it.
 *
 * A driver dump with no separator carries no statement to cut (`UNIQUE
 * constraint failed: sys_user.email`, `SQLITE_CONSTRAINT_NOTNULL: …`) and is
 * returned untouched — there is nothing there but the diagnostic already.
 *
 * ## Not a change to the thrown error
 *
 * This never mutates and never replaces what the engine rethrows. The REST
 * boundary reads the driver's raw message to answer `400 INVALID_FIELD` with
 * the failing field name (`mapDataError`), and that answer is correct and must
 * stay byte-identical. The redaction applies to the LOG SLOT only — one
 * argument at one call site — so the caller's answer and the operator's log
 * diverge exactly where they should.
 */

import { looksLikeInternalErrorLeak } from '@objectstack/types';

/**
 * knex joins the bound statement to the database's own message with this
 * separator. It is the only structural marker the shape offers, and it is
 * stable across the dialects this repo runs (`driver-sql`, `driver-turso`,
 * `driver-sqlite-wasm` all reach knex).
 */
const STATEMENT_SEPARATOR = ' - ';

/** What replaces a statement that carried nothing but values. */
const REDACTED_STATEMENT = '[statement and bound values redacted]';

/** [#8823] What replaces one caller value inlined in the database's own diagnostic. */
const REDACTED_VALUE = '[value redacted]';

/**
 * [#8823] MySQL/MariaDB `ER_DUP_ENTRY` (1062), whole: the template's own head,
 * the conflicting VALUE, and the `for key <index>` tail that anchors it.
 *
 * `Duplicate entry '%-.192s' for key '%-.192s'` — the first slot is whatever the
 * caller tried to write, the second is the index name. MySQL escapes neither,
 * so the value's own closing quote is not distinguishable on sight
 * (`Duplicate entry 'O'Brien' for key 'i'` is a real shape) and only the
 * ` for key '…'` anchor bounds it. The key token requires quotes because that
 * is what separates this template from prose that merely contains the words.
 *
 * The value is matched GREEDILY, so an ambiguous message resolves to the LAST
 * anchor — `Duplicate entry 'a' for key 'b' for key 't.n'` reads as the value
 * `a' for key 'b`, not as a short value with a fragment left standing. Same
 * reasoning as the statement cut taking the last separator: when the shape is
 * ambiguous, discarding more is the only direction that cannot leak. Safe to be
 * greedy here precisely because this runs AFTER the cut, where no statement is
 * left for a match to reach across.
 *
 * The quote class and the key token deliberately mirror the `ER_DUP_ENTRY` limb
 * `DIALECT_LEAK_PHRASINGS` carries in `@objectstack/types` — two files reading
 * one dialect's one template should not disagree about its shape.
 */
const DUPLICATE_ENTRY = /(duplicate entry\s+)["'`][\s\S]*["'`](\s+for key\s+["'`][^"'`]+["'`])/gi;

/**
 * [#8823] The same template with its head already gone — what the statement cut
 * leaves behind when the conflicting VALUE itself contained ` - `.
 *
 * Measured: `insert into … values ('2026 - Q3 plan') - Duplicate entry '2026 -
 * Q3 plan' for key 't.label'` cuts at the separator INSIDE the value and logs
 * `Q3 plan' for key 't.label'`. Same exposure, one shape further on, so it is
 * closed here rather than left for the next reader to rediscover. Everything
 * before the anchor is value residue by construction and is dropped whole.
 */
const DUPLICATE_ENTRY_TAIL = /["'`](\s+for key\s+["'`][^"'`]+["'`])/gi;

/**
 * [#9160] MySQL `ER_TRUNCATED_WRONG_VALUE_FOR_FIELD` (1366) and the
 * column-bound spelling of `ER_TRUNCATED_WRONG_VALUE` (1292).
 *
 * `Incorrect %-.32s value: '%-.128s' for column %.192s at row %ld` — slot one is
 * a TYPE name, slot two is the caller's value, and the `for column '…' at row N`
 * tail names the identifier an operator needs. Measured off a thrown error on
 * live MySQL 8.0.46 (see `sql-driver-diagnostic-value-probe.test.ts`), three
 * type spellings, byte-identical to the manual's template:
 *
 * ```
 * Incorrect integer value: 'CANARY-abc' for column 'age' at row 1
 * Incorrect decimal value: 'CANARY-notanum' for column 'amount' at row 1
 * Incorrect datetime value: 'CANARY-notadate' for column 'when_at' at row 1
 * ```
 *
 * Greedy for the same reason `DUPLICATE_ENTRY` is: MySQL escapes the value's
 * quotes no more here than there, so a value that mimics the anchor resolves to
 * the LAST one. Measured: a value spelled `CANARY' for column 'x' at row 1`
 * really does print two anchors, and the greedy read discards both.
 *
 * ⛔ The neighbouring identifier-only families — `Out of range value for column
 * 'age' at row 1` (1264) and `Data too long for column 'label' at row 1` (1406)
 * — were raised by the same probe and carry NO caller value. They must not
 * match: the anchor here requires the value's closing quote immediately before
 * ` for column`, which those two do not have.
 */
const MYSQL_INCORRECT_VALUE = /(incorrect \w+ value:\s+)'[\s\S]*'(\s+for column\s+'[^']*'\s+at row\s+\d+)/gi;

/** [#9160] {@link MYSQL_INCORRECT_VALUE} with its head cut away by a value containing ` - `. */
const MYSQL_INCORRECT_VALUE_TAIL = /'(\s+for column\s+'[^']*'\s+at row\s+\d+)/gi;

/**
 * [#9160] Postgres `invalid_text_representation` (22P02) and the datetime
 * spelling `invalid_datetime_format` (22007).
 *
 * `invalid input syntax for type %s: "%s"` — the type name is Postgres' own
 * word, the quoted tail is the caller's value. Measured on live PostgreSQL
 * 16.13 across `integer`, `numeric`, `boolean`, `uuid` and `timestamp with time
 * zone`, hence the space-tolerant type class:
 *
 * ```
 * invalid input syntax for type integer: "CANARY-abc"
 * invalid input syntax for type timestamp with time zone: "CANARY-notadate"
 * ```
 *
 * **This is the family the #8823 note was waiting for.** Postgres' unique
 * violation is saved only because its value sits on `error.detail`, which
 * `ObjectLogger.write` does not serialize — recorded there as "coincidence, not
 * a defence". Here the value is on `error.message`, the field that IS
 * serialized, so the coincidence does not cover it and the cut alone does not
 * either.
 *
 * The value runs to END OF MESSAGE with no right anchor, so everything from the
 * opening quote onward is dropped. The valueless spelling
 * `invalid input syntax for type json` (whose token sits on `detail`) has no
 * `: "` and is deliberately left untouched.
 */
const PG_INVALID_INPUT_SYNTAX = /(invalid input syntax for type [a-z0-9 ]+?:\s+)"[\s\S]*$()/gi;

/**
 * [#9275] {@link PG_INVALID_INPUT_SYNTAX}'s head, through the value's opening
 * quote — what the statement cut looks for so a value containing ` - ` cannot
 * eat it. Mirrors group 1 of the pattern above plus the `"` that follows it;
 * the two must not drift, and `head implies whole matches there` is asserted
 * directly rather than left as a comment.
 */
const PG_INVALID_INPUT_SYNTAX_HEAD = /invalid input syntax for type [a-z0-9 ]+?:\s+"/gi;

/**
 * [#9160] Postgres `numeric_value_out_of_range` (22003).
 *
 * `value "%s" is out of range for type %s` — measured live as
 * `value "99999999999" is out of range for type integer`. The out-of-range
 * value is the caller's own, and the type after the anchor is Postgres' word.
 *
 * ⛔ Must not reach `duplicate key value violates unique constraint "…"`: that
 * one has no ` is out of range for type` anchor, and the anchor is what
 * discriminates. The sibling spelling `numeric field overflow` carries no
 * caller value on `message` at all (its precision note is on `detail`).
 */
const PG_VALUE_OUT_OF_RANGE = /(value\s+)"[\s\S]*"(\s+is out of range for type [a-z0-9 ]+)/gi;

/**
 * [#9275] {@link PG_VALUE_OUT_OF_RANGE} with its head cut away by a value
 * containing ` - ` — the row #9160 did not know this family needed.
 *
 * It was left out on the reasoning that an out-of-range value is a NUMBER and a
 * number cannot contain the separator. Measured through the driver's own bind
 * path on live PostgreSQL 16.13, that reasoning is wrong: Postgres' integer
 * parser detects the overflow while scanning digits, BEFORE it rejects the
 * trailing junk, so it echoes the caller's whole string rather than a number.
 *
 * ```
 * insert({ age: '99999999999 - 2026 - Q3' })
 *   raised:  … values ($1) - value "99999999999 - 2026 - Q3" is out of range for type integer
 *   logged:  Q3" is out of range for type integer          ← `Q3` is caller data
 * ```
 *
 * This family keeps its right anchor, so it takes the #8823 recovery and NOT a
 * `head`: everything before ` is out of range for type` is value residue by
 * construction and is dropped whole. ⛔ It must not be given a `head` — its
 * diagnostic continues past the value, which is exactly the shape the head
 * invariant forbids.
 */
const PG_VALUE_OUT_OF_RANGE_TAIL = /"(\s+is out of range for type [a-z0-9 ]+)/gi;

/**
 * [#9160] MySQL `ER_TRUNCATED_WRONG_VALUE` (1292), the spelling that names no
 * column: `Truncated incorrect %-.32s value: '%-.128s'`.
 *
 * Measured live as `Truncated incorrect INTEGER value: 'CANARY-xyz'`, raised by
 * an explicit `cast(… as signed)`. Recorded as a real negative about REACH as
 * well as a positive about shape: the probe could only provoke this spelling
 * through raw SQL, never through the driver's own bind path, which reaches the
 * column-bound 1366/1292 wording above instead. It is listed because it was
 * measured, not because a write path is known to produce it.
 *
 * Value runs to end of message; no right anchor exists to recover a head-gone
 * residue, which is why this family takes a `head` instead (#9275).
 */
const MYSQL_TRUNCATED_INCORRECT_VALUE = /(truncated incorrect \w+ value:\s+)'[\s\S]*$()/gi;

/**
 * [#9275] {@link MYSQL_TRUNCATED_INCORRECT_VALUE}'s head, through the value's
 * opening quote. Mirrors group 1 of the pattern above plus the `'` after it.
 *
 * The type token really does vary in case — `INTEGER`, `DOUBLE` and `time` were
 * all raised on live MySQL 8.0.46 — so the `i` flag here is load-bearing, not
 * decoration.
 */
const MYSQL_TRUNCATED_INCORRECT_VALUE_HEAD = /truncated incorrect \w+ value:\s+'/gi;

/**
 * [#9160] Every dialect template MEASURED to inline a caller's value in the
 * database's own diagnostic, in the order they are tried.
 *
 * ⛔ The standing rule (`unique-violation.ts`) governs this list: a row goes in
 * once its phrasing has been raised off a THROWN error, never from a reading of
 * the manual. Every row below cites the live server that produced it, and
 * `sql-driver-diagnostic-value-probe.test.ts` re-raises each one against the
 * MySQL/Postgres services the `Temporal Conformance (live PG + MySQL)` job
 * stands up — so a row whose phrasing drifts, or a NEW family that starts
 * inlining a value, becomes a named red instead of a silent leak. That probe is
 * the answer to "how would anyone notice a second entry is missing"; this list
 * is only half of the pair and must not be extended without it.
 *
 * `whole` matches head + value + kept tail (group 1 kept before the value,
 * group 2 kept after). `tail` is the same template after the statement cut has
 * eaten its head — which happens when the VALUE itself contained ` - ` — and
 * drops everything before the anchor, because an anchor is evidence about the
 * value, not licence to assert which template printed it.
 */
interface ValueBearingTemplate {
  /** Dialect and the server's own error code, as the probe raises it. */
  readonly id: string;
  /** Head + value + anchor. */
  readonly whole: RegExp;
  /** The head-gone residue, when the template has a right anchor to recover it. */
  readonly tail?: RegExp;
  /**
   * [#9275] The template's head through the value's OPENING QUOTE — what the
   * statement cut looks for so a value containing ` - ` cannot eat it.
   *
   * ⛔ INVARIANT, and the only thing standing between this and a leak: a `head`
   * may be declared ONLY on a template whose value runs to END OF MESSAGE, i.e.
   * whose `whole` is `$`-anchored and whose group 2 is empty. The head-anchored
   * cut can land inside the STATEMENT (a hostile value may spell a head), and
   * what makes that over-redaction rather than exposure is that `whole` then
   * swallows everything after the head — statement remainder included. A
   * template with a right anchor would instead keep whatever follows that
   * anchor, which on such a cut is statement, which is caller values.
   *
   * Families that DO have a right anchor take {@link tail} instead; it recovers
   * the same residue with no cut change at all. Both are asserted structurally
   * by `driver-fault-redaction.test.ts` rather than trusted from this note.
   */
  readonly head?: RegExp;
}

const VALUE_BEARING_TEMPLATES: readonly ValueBearingTemplate[] = [
  { id: 'mysql/1062 ER_DUP_ENTRY', whole: DUPLICATE_ENTRY, tail: DUPLICATE_ENTRY_TAIL },
  { id: 'mysql/1366 ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', whole: MYSQL_INCORRECT_VALUE, tail: MYSQL_INCORRECT_VALUE_TAIL },
  { id: 'mysql/1292 ER_TRUNCATED_WRONG_VALUE', whole: MYSQL_TRUNCATED_INCORRECT_VALUE, head: MYSQL_TRUNCATED_INCORRECT_VALUE_HEAD },
  { id: 'pg/22P02 invalid_text_representation', whole: PG_INVALID_INPUT_SYNTAX, head: PG_INVALID_INPUT_SYNTAX_HEAD },
  { id: 'pg/22003 numeric_value_out_of_range', whole: PG_VALUE_OUT_OF_RANGE, tail: PG_VALUE_OUT_OF_RANGE_TAIL },
];

/**
 * [#9275] Every known diagnostic head, as the separator that stands before it.
 *
 * A lookahead, so the match is the SEPARATOR alone and its index is where the
 * cut goes. Built once from the table above: a row that declares a `head` is
 * enrolled here automatically, and one that does not cannot be enrolled by
 * hand.
 */
const HEAD_ANCHORED_CUTS: readonly RegExp[] = VALUE_BEARING_TEMPLATES
  .filter((template): template is ValueBearingTemplate & { head: RegExp } => template.head !== undefined)
  .map((template) => new RegExp(`${STATEMENT_SEPARATOR}(?=${template.head.source})`, 'gi'));

/**
 * The first stack FRAME line (`    at …`). Everything above it is the header
 * that repeats `name: message` — and therefore repeats the statement.
 */
const FIRST_STACK_FRAME = /^[ \t]*at\s/m;

/**
 * Strip the bound statement from a driver error's `message` and `stack`,
 * keeping the database's own diagnostic.
 *
 * Returns the input UNCHANGED (same reference) when there is nothing to
 * redact — not a driver dump, or a dump that carries no statement — so a
 * validation error, a hook's business error and a bare `Error` from our own
 * code all reach the log exactly as before, stack frames included.
 *
 * Otherwise returns a NEW `Error` carrying the redacted text and the original
 * frames. It must be a real `Error`: `ObjectLogger.error` routes its second
 * argument by `instanceof Error`, and a plain object would silently land in
 * the meta slot instead.
 *
 * @param error - the thrown value, of any shape.
 */
export function redactBoundStatement(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const redactedMessage = redactStatementFromMessage(error.message);
  if (redactedMessage === error.message) return error;

  const redacted = new Error(redactedMessage);
  redacted.name = error.name;
  redacted.stack = redactStack(error.stack, error.name, redactedMessage);
  return redacted;
}

/**
 * The message half, exported for the cases that pin the cut directly.
 * Returns the input string unchanged when nothing is cut.
 */
export function redactStatementFromMessage(message: string): string {
  if (!message || !looksLikeInternalErrorLeak(message)) return message;
  const cut = statementCut(message);
  // No statement to cut — but a dialect may still have inlined a value in the
  // diagnostic itself, and since #9030 taught the shared predicate this
  // phrasing, a BARE `Duplicate entry …` now reaches this line instead of
  // being turned away above.
  if (cut === -1) return redactDiagnosticValues(message);
  const diagnostic = redactDiagnosticValues(message.slice(cut + STATEMENT_SEPARATOR.length).trim());
  // A dump whose tail is empty still had its head removed: report the
  // redaction rather than an empty message, so the entry never reads as a
  // fault with no detail at all.
  return diagnostic.length > 0
    ? `${diagnostic} ${REDACTED_STATEMENT}`
    : REDACTED_STATEMENT;
}

/**
 * [#9275] Where the bound statement ends — the index of its separator, or `-1`
 * when the message carries no statement at all.
 *
 * The LAST separator that stands immediately before a MEASURED diagnostic head
 * wins, because a head is positive evidence about where the database's own
 * words began; only when no head appears does this fall back to the last
 * separator in the message, which is #8682's original structural answer.
 *
 * Two orderings carry the safety argument, both spelled out in the head note at
 * the top of this file and pinned by their own cases:
 *
 *  - the last HEAD, not the first — so a value mimicking a head is cut at the
 *    mimic and cannot survive behind its own decoy;
 *  - a head beats the last separator even though it keeps MORE text, which is
 *    only sound because the head invariant guarantees that extra text is
 *    swallowed whole by the template that owns the head.
 */
function statementCut(message: string): number {
  let headCut = -1;
  for (const separator of HEAD_ANCHORED_CUTS) {
    const match = lastMatch(separator, message);
    if (match && match.index > headCut) headCut = match.index;
  }
  return headCut !== -1 ? headCut : message.lastIndexOf(STATEMENT_SEPARATOR);
}

/**
 * [#8823] Drop the caller values a dialect inlines into its OWN diagnostic,
 * keeping every identifier around them.
 *
 * Runs on the tail the statement cut already produced, never on the whole
 * message: after the cut there is nothing left but the database's words, so the
 * templates below can be read literally. ⛔ The one exception is deliberate and
 * bounded — {@link statementCut} matches a template's `head` BEFORE the cut, so
 * that a value containing ` - ` cannot eat it. That amendment, the steering it
 * admits and the invariant that keeps the steering to over-redaction rather
 * than exposure are argued in the head note (#9275); nothing here reads a
 * template earlier than the cut on its own account.
 *
 * ⛔ Add a dialect's spelling to {@link VALUE_BEARING_TEMPLATES} only once it has
 * been measured off a THROWN error, never from a reading of the manual — the
 * standing rule in this neighbourhood (`unique-violation.ts`). Since #9160 that
 * measurement has a home: add the family to the live probe, read what the server
 * actually printed, and let the recording be the warrant. Over-matching is still
 * the expensive direction — it deletes the diagnostic an operator came for — so
 * a row that the probe cannot raise does not go in.
 */
function redactDiagnosticValues(diagnostic: string): string {
  // Every INTACT template first, then every head-gone residue. Whole-before-tail
  // is global rather than per-template on purpose: a diagnostic that still
  // carries a recognisable head should be reported with that head, whichever
  // family it belongs to, rather than collapsed into a bare anchor by an
  // earlier row's tail pattern.
  for (const template of VALUE_BEARING_TEMPLATES) {
    const whole = lastMatch(template.whole, diagnostic);
    if (whole) {
      // The template's head survived, so keep it and the database's own wording
      // around it — only the value slot is replaced.
      return diagnostic.slice(0, whole.index)
        + whole[1] + REDACTED_VALUE + whole[2]
        + diagnostic.slice(whole.index + whole[0].length);
    }
  }

  for (const template of VALUE_BEARING_TEMPLATES) {
    if (!template.tail) continue;
    const tail = lastMatch(template.tail, diagnostic);
    if (tail) {
      // Head gone: everything before the anchor is what is left of the value.
      // The words are NOT reconstructed — an anchor is evidence about the value,
      // not licence to assert which template printed it.
      return REDACTED_VALUE + tail[1] + diagnostic.slice(tail.index + tail[0].length);
    }
  }

  return diagnostic;
}

/**
 * The LAST match of a sticky-free global pattern, or `undefined`.
 *
 * Last, not first, for the reason the statement cut takes the last separator:
 * a value may itself contain the anchor, and the later match is the one the
 * database printed. `lastIndex` is reset so the shared `RegExp` objects above
 * carry no state between calls.
 */
function lastMatch(pattern: RegExp, text: string): RegExpExecArray | undefined {
  pattern.lastIndex = 0;
  let found: RegExpExecArray | undefined;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    found = m;
    if (m[0].length === 0) break;
  }
  pattern.lastIndex = 0;
  return found;
}

/**
 * Rebuild `stack` so its header carries the redacted message instead of the
 * statement, keeping every frame.
 *
 * The header is located by the first FRAME line, not by matching the message:
 * a bound statement can contain newlines, so the header is not reliably one
 * line and a `replace(message, …)` would leave the remainder standing.
 */
function redactStack(stack: string | undefined, name: string, redactedMessage: string): string | undefined {
  const header = `${name}: ${redactedMessage}`;
  if (stack === undefined) return undefined;
  const frame = FIRST_STACK_FRAME.exec(stack);
  if (!frame) return header;
  return `${header}\n${stack.slice(frame.index)}`;
}
