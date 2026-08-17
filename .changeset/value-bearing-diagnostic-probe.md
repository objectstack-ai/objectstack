---
"@objectstack/objectql": patch
"@objectstack/driver-sql": patch
---

fix(objectql): stop logging the caller's value for four MORE diagnostic families — measured off live MySQL 8.0 / PostgreSQL 16, not read off a manual (#9160)

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
