<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:strictness-ledger -->

# `data/` — unknown-key strictness counts (generated)

Every number the #4001 strictness ledger publishes about `packages/spec/src/data/`,
computed from the AST (`packages/spec/scripts/lib/strictness-ledger.ts`).

The verdicts, the evidence and the exemption rationales live in
[the ledger itself](../2026-07-unknown-key-strictness-ledger.md) and are
hand-written; **this file has no prose to preserve** and is regenerated whole.
One file per directory, and no total across directories is committed anywhere:
`check:strictness-ledger` sums the shards when it reads them. **Never
hand-patch a number here** — fix the code or the verdict and regenerate.

## Posture

The `strict` column is the one the campaign schedules against; it counts both the
`strictObject(` helper and the older `z.object(…).strict()` spelling, and — since
#5072 — no longer counts a `strictObject(…).passthrough()` chain as closed.

| Dir | Sites | strict | passthrough | catchall | strip |
|---|---|---|---|---|---|
| `data/` | 155 | 79 | 2 | 0 | 74 |

## `data/` — sites

Object sites per file: every `z.object(` / `strictObject(` / `z.strictObject(` /
`z.looseObject(` CALL, read from the AST. A file with zero sites has nothing to
classify and is not listed (it becomes reportable the day it grows its first site).

| File | Sites |
|---|---|
| `analytics.zod.ts` | 6 |
| `data-engine.zod.ts` | 15 |
| `datasource.zod.ts` | 6 |
| `driver-nosql.zod.ts` | 10 |
| `driver-sql.zod.ts` | 2 |
| `driver.zod.ts` | 9 |
| `driver/memory.zod.ts` | 6 |
| `driver/mongo.zod.ts` | 1 |
| `driver/mysql.zod.ts` | 1 |
| `driver/postgres.zod.ts` | 1 |
| `driver/sqlite.zod.ts` | 2 |
| `driver/turso.zod.ts` | 2 |
| `external-catalog.zod.ts` | 4 |
| `field-value.zod.ts` | 3 |
| `field.zod.ts` | 13 |
| `filter.zod.ts` | 12 |
| `hook-body.zod.ts` | 2 |
| `hook.zod.ts` | 7 |
| `mapping.zod.ts` | 5 |
| `object.zod.ts` | 21 |
| `picklist.zod.ts` | 3 |
| `query.zod.ts` | 5 |
| `seed-loader.zod.ts` | 12 |
| `seed.zod.ts` | 1 |
| `validation.zod.ts` | 6 |
| **total** | **155** |

## `data/` — open

Per file, how many of its sites still silently discard unknown keys. The `Class`
column that decides the bucket split is hand-written in the ledger; the arithmetic
over it is here.

**74 strip of 155**, in 10 file(s).

| File | Strip | Sites |
|---|---|---|
| `data-engine.zod.ts` | 15 | 15 |
| `driver-nosql.zod.ts` | 10 | 10 |
| `driver-sql.zod.ts` | 2 | 2 |
| `driver.zod.ts` | 9 | 9 |
| `external-catalog.zod.ts` | 4 | 4 |
| `field.zod.ts` | 2 | 13 |
| `filter.zod.ts` | 11 | 12 |
| `hook.zod.ts` | 5 | 7 |
| `query.zod.ts` | 4 | 5 |
| `seed-loader.zod.ts` | 12 | 12 |
| **total** | **74** | **155** |

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 0 |
| unresolved — needs a per-schema verdict | 0 |
| wire / open — out of forced scope | 72 |
| no door — no carrier, ADR-0049 territory | 2 |
| no gate — carrier live, no parse | 0 |
| covered — no carrier, no parse, guarded at every consumer | 0 |
