---
"@objectstack/types": minor
"@objectstack/rest": patch
---

fix(types,rest): one named answer for "which column conflicted" — an index name is never returned as one (#6544)

#6250 retired four private "is this a unique violation?" vocabularies into
`isUniqueViolationError`. It left the harder half of the question behind: the
import runner's `sanitizeRowError` still carried its own three-dialect regex
chain, because it does **more** than answer yes/no — it names the offending
column so the importer can say *"A record with this `email` already exists."*
This lands that second answer as a shared export and migrates the last private
copy onto it.

**New — `uniqueViolationColumn(error)` in `@objectstack/types`** (`string |
undefined`), sibling to `isUniqueViolationError` and gated on it, reading the
same channels one step down the same bounded `cause` chain, plus
node-postgres' `detail` field.

**Its contract, per the maintainer's 2026-08-08 ruling: a value comes back only
when the identifier the driver printed is determinably a COLUMN.** When a
dialect names an *index* instead — MySQL's `Duplicate entry … for key
'idx_email_unique'`, Postgres' `violates unique constraint "sys_user_email_key"`,
SQLite's `UNIQUE constraint failed: index 'x'` — the answer is `undefined`,
never the index name. Callers render this into a form field, and an index name
mistaken for a column points the user at a field that does not exist, whereas
`undefined` degrades to generic copy. A **composite** key (`Key (tenant_id,
email)=(…)`) is `undefined` for the same reason: there is no single offending
column, and naming the first is the same class of wrong answer.

**⚠️ User-visible change on MySQL imports.** MySQL's duplicate-entry message
names the index and never the column, so the importer no longer names a column
there: rows that used to read *"A record with this `idx_email_unique` already
exists."* — or, on MySQL 8's table-qualified `for key 'sys_user.email'`, a
plausible-looking *`email`* that was still an index name — now read **"A record
with this value already exists."** That is deliberate and is the accepted cost
of the ruling. The conflict is still recognised as a conflict; only the naming
narrowed.

Three smaller import messages improve in the same move, all previously wrong
rather than merely vague:

- SQLite's expression/partial-index form used to render as *"A record with this
  **index** already exists."*
- Postgres' expression index used to render the truncated fragment *"A record
  with this **lower(email** already exists."*
- A Postgres conflict with no `DETAIL:` line used to fall through to the SQL
  backstop and echo the driver's own sentence — index name included — at the
  importer. It now gets the same generic conflict copy, which is also the exact
  wording `mapDataError` puts in the 409 `UNIQUE_VIOLATION` body, so the
  importer and the API say one thing about one condition.

Not changed: the NOT NULL branch, the raw-SQL backstop, and every non-conflict
message, which pass through exactly as before.
