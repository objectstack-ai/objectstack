---
"@objectstack/driver-sql": patch
---

docs(driver-sql): state the autonumber contract — unique and monotonic per scope, NOT gapless (#8283)

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
