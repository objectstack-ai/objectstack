---
"@objectstack/service-datasource": minor
---

feat(datasource): size the SQL connection pool from `OS_DATABASE_POOL_MAX`

A multi-replica deployment had no supported way to raise the number of database
connections each replica opens. The reporter measured a live 3-replica cluster
whose authed data API plateaued at ~25 rps while Postgres held only ~9-21 of its
200 connections: the ceiling was the client pool, and the operator had no knob
for it. Adding replicas raised the ceiling; sizing the pool — the cheap half —
was not expressible at all.

The pool for a `postgres` / `mysql` datasource is built by `buildSqlPool`, which
gives every datasource that declares no `pool` block an explicit `{min: 0,
max: 5}`. That includes the primary datasource: the one behind
`OS_DATABASE_URL` is composed as a url and nothing else, so `max: 5` per replica
was the effective ceiling on every self-hosted deployment, and it was reachable
only by hand-authoring a `pool` block onto a datasource the operator does not
write.

`buildSqlPool` now reads `OS_DATABASE_POOL_MAX`. Precedence is a declared
`pool.max` first, then the env, then today's `5` — an operator knob does not
override what an author wrote about their own datasource, and it is the only
site that decides the unspecified case, so the ordering is expressed once.

**Nothing changes when the variable is unset**, which is the upgrade path for
every existing deployment: the pool stays exactly `{min: 0, max: 5}`, pinned by
a test whose job is to stay red if that ever drifts. A blank value is read as
unset, so a declared-but-unfilled compose variable keeps today's behaviour too.

A value that is not a positive integer refuses the boot, naming the variable,
the value it rejected and the sizing rule — rather than the lenient
`Number(process.env.X ?? default)` shape, where a typo becomes `NaN` and the
operator who was trying to raise the ceiling silently keeps the one they meant
to leave. A pool ceiling is only ever measured in production.

Size it with `replicas × OS_DATABASE_POOL_MAX` below the database's
`max_connections`, leaving headroom for migrations and admin connections.

Only `postgres` / `mysql` are affected — they are the two arms that build a
pool. `memory` / `sqlite` / `sqlite-wasm` / `turso` receive no pool parameter
and reject a declared one outright; the env is read inside a function those arms
never call, so it cannot reach them. `OS_DATABASE_POOL_MIN` is deliberately not
exposed: this path already runs `min: 0`.
