<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:strictness-ledger -->

# `automation/` — unknown-key strictness counts (generated)

Every number the #4001 strictness ledger publishes about `packages/spec/src/automation/`,
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
| `automation/` | 61 | 37 | 0 | 1 | 23 |

## `automation/` — sites

Object sites per file: every `z.object(` / `strictObject(` / `z.strictObject(` /
`z.looseObject(` CALL, read from the AST. A file with zero sites has nothing to
classify and is not listed (it becomes reportable the day it grows its first site).

| File | Sites |
|---|---|
| `approval.zod.ts` | 4 |
| `bpmn-interop.zod.ts` | 5 |
| `builtin-node-config.zod.ts` | 10 |
| `control-flow.zod.ts` | 6 |
| `execution.zod.ts` | 12 |
| `flow-function.zod.ts` | 1 |
| `flow.zod.ts` | 11 |
| `io-node-config.zod.ts` | 2 |
| `node-executor.zod.ts` | 4 |
| `schemaless-node-config.zod.ts` | 4 |
| `time-relative-trigger.zod.ts` | 1 |
| `webhook.zod.ts` | 1 |
| **total** | **61** |

## `automation/` — open

Per file, how many of its sites still silently discard unknown keys. The `Class`
column that decides the bucket split is hand-written in the ledger; the arithmetic
over it is here.

**23 strip of 61**, in 5 file(s).

| File | Strip | Sites |
|---|---|---|
| `bpmn-interop.zod.ts` | 5 | 5 |
| `control-flow.zod.ts` | 1 | 6 |
| `execution.zod.ts` | 12 | 12 |
| `flow.zod.ts` | 1 | 11 |
| `node-executor.zod.ts` | 4 | 4 |
| **total** | **23** | **61** |

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 0 |
| unresolved — needs a per-schema verdict | 0 |
| wire / open — out of forced scope | 23 |
| no door — no carrier, ADR-0049 territory | 0 |
| no gate — carrier live, no parse | 0 |
| covered — no carrier, no parse, guarded at every consumer | 0 |
