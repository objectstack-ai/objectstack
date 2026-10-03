<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:strictness-ledger -->

# `ui/` — unknown-key strictness counts (generated)

Every number the #4001 strictness ledger publishes about `packages/spec/src/ui/`,
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
| `ui/` | 190 | 180 | 3 | 0 | 7 |

## `ui/` — sites

Object sites per file: every `z.object(` / `strictObject(` / `z.strictObject(` /
`z.looseObject(` CALL, read from the AST. A file with zero sites has nothing to
classify and is not listed (it becomes reportable the day it grows its first site).

| File | Sites |
|---|---|
| `action-params.zod.ts` | 1 |
| `action.zod.ts` | 9 |
| `app.zod.ts` | 19 |
| `bulk-action.zod.ts` | 4 |
| `chart.zod.ts` | 8 |
| `component.zod.ts` | 60 |
| `dashboard.zod.ts` | 11 |
| `dataset.zod.ts` | 4 |
| `i18n.zod.ts` | 1 |
| `page.zod.ts` | 7 |
| `report.zod.ts` | 3 |
| `responsive.zod.ts` | 1 |
| `sharing.zod.ts` | 1 |
| `view.zod.ts` | 60 |
| `widget.zod.ts` | 1 |
| **total** | **190** |

## `ui/` — open

Per file, how many of its sites still silently discard unknown keys. The `Class`
column that decides the bucket split is hand-written in the ledger; the arithmetic
over it is here.

**7 strip of 190**, in 4 file(s).

| File | Strip | Sites |
|---|---|---|
| `action-params.zod.ts` | 1 | 1 |
| `app.zod.ts` | 1 | 19 |
| `view.zod.ts` | 4 | 60 |
| `widget.zod.ts` | 1 | 1 |
| **total** | **7** | **190** |

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 1 |
| unresolved — needs a per-schema verdict | 0 |
| wire / open — out of forced scope | 4 |
| no door — no carrier, ADR-0049 territory | 1 |
| no gate — carrier live, no parse | 0 |
| covered — no carrier, no parse, guarded at every consumer | 1 |
