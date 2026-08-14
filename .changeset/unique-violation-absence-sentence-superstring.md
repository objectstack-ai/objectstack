---
"@objectstack/types": patch
---

fix(types): `isUniqueViolationError` stops claiming the sentences that say a unique constraint is ABSENT (#8590)

The shared predicate's message limb was a bare `unique constraint`, and a word
pair is not a condition. Every dialect that can say "this row violated a unique
constraint" can also say "there is no unique constraint here", and the same two
words sit adjacent in both — so the predicate answered **true** for errors
meaning the exact opposite of what it detects. `rest-server.ts` maps that
verdict to `409 UNIQUE_VIOLATION`, which tells a client to change a value when
nothing was ever compared, on a status an SDK will not retry.

**Measured on live servers for this fix, all three supported dialect families**
— SQLite via better-sqlite3, PostgreSQL 16.13 via `pg` 8.22.0, MariaDB 10.11.14
via `mysql2` 3.23.1, all through knex 3.3.0 — driving each dialect through both
conditions plus the NOT NULL / FOREIGN KEY near misses:

```
sqlite   ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
           -> was true, WRONG (the reported defect, #8590)
postgres there is no unique constraint matching given keys for referenced table "t"
           -> was true, WRONG (42830 — found by this fix's dialect sweep)
postgres there is no unique or exclusion constraint matching the ON CONFLICT specification
           -> false (the pair is not adjacent here)
mysql    the condition cannot arise: knex compiles to ON DUPLICATE KEY UPDATE,
         which carries no conflict target (confirmed against a live server)
```

**Postgres was not clean either, and that chose the fix.** #8590 was filed
reading the collision as SQLite-only, with Postgres escaping "by luck of word
order". The sweep raised **42830** — a `FOREIGN KEY` referencing a non-unique
column — where Postgres puts `unique constraint` adjacent in its own absence
sentence. The card offered two candidate fixes; only one survives 42830. A
negative lookahead on SQLite's missing-index sentence is a blocklist that can
only enumerate absence sentences somebody already tripped over, and it answers
`true` on 42830. So the limb now requires a **violation phrasing** —
`unique constraint failed` (SQLite) or `violates unique constraint` (Postgres) —
which restores the module's own stated default, *unrecognised is `false`*, to
the message channel.

**Both spellings the retired limb covered are preserved exactly**, which was the
constraint on the fix: the limb was inherited verbatim from the REST branch
#6250 replaced and covered SQLite's `UNIQUE constraint failed: t.c` *and*
Postgres' `... violates unique constraint "..."`. The `unique violation`,
`duplicate key` and `duplicate entry` limbs are untouched, as are the `code` and
`errno` channels — MySQL's `Duplicate entry` path never went through the
narrowed limb at all.

**No user-visible behaviour changes today; this closes a latent inversion.** The
one site compiling a caller-supplied conflict target (`SqlDriver.upsert`)
recognises the unbacked target *first* in its catch and throws a refusal
declaring `status: 400`, and `mapDataError` reads `declaredHttpStatus` before it
reaches the unique-violation branch — so the 409 was gated off the wire by
ordering, not by the verdict. That ordering was the only thing standing between
this and a wrong status, which is why the verdict is now pinned rather than left
to it. A repo-wide scan of every string literal whose verdict moves found no
consumer relying on the old answer: all of them are prose, a different
predicate's vocabulary (`looksLikeInternalErrorLeak` keeps its own list), or
fixtures asserted through the status-passthrough path.

`unbacked-conflict-target.test.ts`'s pin — written by #8567 to point at itself
rather than go quietly green — is **inverted, not deleted**, and
`unique-violation-absence-sentences.test.ts` pins the absence sentences per
dialect in both directions, including the code channel, so re-reading `code`
cannot undo the message-side fix from the other side.
