---
"@objectstack/types": patch
"@objectstack/rest": patch
---

fix(types,rest): one named unique-violation predicate — a MySQL conflict is 409 UNIQUE_VIOLATION, not 500 (#6250)

**On MySQL, every unique-constraint conflict came back as `500 INTERNAL_ERROR`.**
The API contract registers `UNIQUE_VIOLATION` as a 409 code
(`packages/spec/src/api/error-code-ledger.zod.ts`), so a front end had no way to
tell "this email is already taken" from "the server fell over" — no retry advice,
no field to point at, and a 5xx in the operator's dashboards for what is an
ordinary client outcome. SQLite and Postgres deployments never saw it, which is
why it survived: their conflict prose happens to contain the words the mapping
looked for.

**Cause: the conflict verdict was nested inside a leak heuristic.** REST's 409
branch lived inside the true-branch of `looksLikeInternalErrorLeak()`, keyed on
the substrings `unique constraint` / `unique violation`. MySQL says
`ER_DUP_ENTRY: Duplicate entry '…' for key '…'`, which matches no limb of that
heuristic, so the conflict never reached the `if` at all and fell out of the
terminal `UNCLASSIFIED_FAULT`. Two unrelated questions — "is this a conflict?"
and "would echoing this text leak internals?" — had been fused into one, and
MySQL is where they disagree.

Measured on the previous release, through the real error mapper:

```
mysql,    bare message       500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
mysql,    knex-wrapped SQL   500 DATABASE_ERROR  →  409 UNIQUE_VIOLATION
postgres, SQLSTATE only      500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
sqlite,   message            409 UNIQUE_VIOLATION   (unchanged)
postgres, message            409 UNIQUE_VIOLATION   (unchanged)
```

So the hole was never MySQL-only: the mapping read one of the two channels
drivers use. A Postgres error carrying SQLSTATE `23505` with unremarkable prose
was a 500 as well.

**New: `isUniqueViolationError(error)`, exported from `@objectstack/types`.** One
named predicate replaces the substring test, reading every channel a driver
uses — `code` (`23505` / `ER_DUP_ENTRY` / `SQLITE_CONSTRAINT_UNIQUE`), `errno`
(`1062`), the message, and one step down the `cause` chain that pool and
query-builder layers wrap with. Its vocabulary is the union of the four
hand-written copies the repo already carried, so routing REST through it cannot
narrow any verdict clients rely on today; an unrecognised error is never a
conflict, because a false 409 tells an SDK not to retry and points the user at a
value that is fine.

**The internal-leak classifier is byte-identical.** The fix hoists the conflict
question out of it rather than widening its criteria, so nothing else it guards
is reclassified as safe-to-expose. And the 409 body is fixed text: MySQL embeds
the offending user data in its message (`Duplicate entry 'a@b.com' …`) and
Postgres the index and column names, none of which reaches the client. The full
driver text still reaches the server log.

No action needed. Clients that already handled `409 UNIQUE_VIOLATION` on SQLite
and Postgres now receive it on MySQL too.
