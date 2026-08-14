---
"@objectstack/driver-sql": minor
---

fix(driver-sql): MySQL refuses an upsert whose `conflictKeys` no PRIMARY KEY or UNIQUE index backs — calls that previously "resolved" now throw (#8621)

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
