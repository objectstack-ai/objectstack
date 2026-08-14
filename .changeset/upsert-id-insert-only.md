---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a merge-path upsert stops rewriting the row's primary key (#8622)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is
renamed, retired or tombstoned. The change is entirely inside
`SqlDriver.upsert`'s merge-set construction: one column joins the existing
insert-only exclusion set that `created_at` and `auto_number` are already in. -->

`upsert(data, conflictKeys)` on a **business key** — the ordinary way to ingest
external data — silently replaced the `id` of the row it merged into. Every
relationship, audit record, external id mapping and client-held reference
pointing at that row was left dangling, with no error raised on any dialect.

Measured on a properly BACKED conflict target (`email` declared `unique: true`),
so this was the supported path, not an error path:

```
upsert({ email: 'x@b.com', title: 'first'  }, ['email'])
upsert({ email: 'x@b.com', title: 'second' }, ['email'])

[sqlite] before=[{id:'yMh3oywrp0Z6p-oJ', title:'first'}]
         after =[{id:'d8T8rUlTxlRlaUhN', title:'second'}]   idPreserved=false
[pg]     before=[{id:'T3AlYiyDi5buzGvW', title:'first'}]
         after =[{id:'TvbCTa5mydWPYP76', title:'second'}]   idPreserved=false
```

One row throughout, as intended — with a different primary key. `upsert` mints a
nanoid for any call that supplies none, and `id` travelled in the merge set, so
`… on conflict ("email") do update set …, "id" = excluded."id"` wrote the
**losing** insert's fresh id over the winning row's. On the default `['id']`
conflict target that clause is a no-op (both sides hold the same value), which is
exactly why it stayed invisible for so long.

`id` is now insert-only on the merge path, joining `created_at` and the
`auto_number` columns (#7011) in `insertOnlyUpsertColumns` — the same exclusion
argument at its strongest instance, since the primary key *is* the platform's row
identity. It is resolved through `remoteColumn`, because a federated object can
bind `id` to a differently-named physical column (ADR-0015 §18) and a literal
`'id'` would filter nothing there.

**The accept set is unchanged**: the same calls still succeed, still merge, and
still advance `updated_at` and every other mergeable column — the merge simply
stops rewriting row identity. Re-keying a row deliberately is still `update()`'s
job, which writes exactly the columns it is handed.

Measured on SQLite and live PostgreSQL 16.13. Live MySQL 8.0.46 measured the same
rewrite in #8592 and its characterization pin is rewritten here to assert
preservation; that cell had no server available in this container and runs first
in CI's `Temporal Conformance (live PG + MySQL)` job.
