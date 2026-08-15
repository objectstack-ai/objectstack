---
"@objectstack/driver-sql": minor
"@objectstack/spec": patch
---

fix(driver-sql): refuse — and roll back — a MySQL upsert that merges onto a row the caller never identified (#8807)

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
