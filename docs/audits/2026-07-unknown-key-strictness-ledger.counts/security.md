<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:strictness-ledger -->

# `security/` — unknown-key strictness counts (generated)

Every number the #4001 strictness ledger publishes about `packages/spec/src/security/`,
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
| `security/` | 20 | 7 | 0 | 0 | 13 |

## `security/` — sites

Object sites per file: every `z.object(` / `strictObject(` / `z.strictObject(` /
`z.looseObject(` CALL, read from the AST. A file with zero sites has nothing to
classify and is not listed (it becomes reportable the day it grows its first site).

| File | Sites |
|---|---|
| `explain.zod.ts` | 11 |
| `permission.zod.ts` | 4 |
| `rls.zod.ts` | 3 |
| `sharing.zod.ts` | 2 |
| **total** | **20** |

## `security/` — open

Per file, how many of its sites still silently discard unknown keys. The `Class`
column that decides the bucket split is hand-written in the ledger; the arithmetic
over it is here.

**13 strip of 20**, in 2 file(s).

| File | Strip | Sites |
|---|---|---|
| `explain.zod.ts` | 11 | 11 |
| `rls.zod.ts` | 2 | 3 |
| **total** | **13** | **20** |

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 0 |
| unresolved — needs a per-schema verdict | 0 |
| wire / open — out of forced scope | 13 |
| no door — no carrier, ADR-0049 territory | 0 |
| no gate — carrier live, no parse | 0 |
| covered — no carrier, no parse, guarded at every consumer | 0 |
