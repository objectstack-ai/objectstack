<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:strictness-ledger -->

# `studio/` — unknown-key strictness counts (generated)

Every number the #4001 strictness ledger publishes about `packages/spec/src/studio/`,
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
| `studio/` | 27 | 27 | 0 | 0 | 0 |

## `studio/` — sites

Object sites per file: every `z.object(` / `strictObject(` / `z.strictObject(` /
`z.looseObject(` CALL, read from the AST. A file with zero sites has nothing to
classify and is not listed (it becomes reportable the day it grows its first site).

| File | Sites |
|---|---|
| `flow-builder.zod.ts` | 7 |
| `object-designer.zod.ts` | 12 |
| `plugin.zod.ts` | 8 |
| **total** | **27** |

## `studio/` — open

Per file, how many of its sites still silently discard unknown keys. The `Class`
column that decides the bucket split is hand-written in the ledger; the arithmetic
over it is here.

**0 strip of 27**, in 0 file(s).

This directory is closed.
