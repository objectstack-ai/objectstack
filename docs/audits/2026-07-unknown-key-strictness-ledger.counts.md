<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:strictness-ledger -->

# Unknown-key strictness ledger — the counts (generated)

Every number the #4001 strictness ledger publishes, computed from the AST
(`packages/spec/scripts/lib/strictness-ledger.ts`). The verdicts, the evidence and
the exemption rationales live in [the ledger itself](./2026-07-unknown-key-strictness-ledger.md) and
are hand-written; **this file has no prose to preserve** and is regenerated whole.

Split out at #5107. These numbers were the ledger's entire merge-conflict surface:
two batches each decrement a header by their own delta, git merges the rows cleanly,
and the subtotal — which conflicts with nothing — merges clean and wrong. Seven cases
in one day. The correct resolution was always "recompute from the merged tree", so the
path carries `merge=os-regen` (#4675) and the recomputation is now mandatory rather
than remembered. **Never hand-patch a number here** — fix the code or the verdict and
regenerate.

## Global

| Measure | Value |
|---|---|
| Triaged directories | 5 |
| Object sites in them | 456 |
| Still-open (strip) sites | 197 |
| Files carrying at least one | 30 |

Remaining strip sites by class:

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 43 |
| unresolved — needs a per-schema verdict | 33 |
| wire / open — out of forced scope | 107 |
| no door — no carrier, ADR-0049 territory | 14 |
| no gate — carrier live, no parse | 0 |

## Posture, per triaged directory

The `strict` column is the one the campaign schedules against; it counts both the
`strictObject(` helper and the older `z.object(…).strict()` spelling, and — since
#5072 — no longer counts a `strictObject(…).passthrough()` chain as closed.

| Dir | Sites | strict | passthrough | catchall | strip |
|---|---|---|---|---|---|
| `ui/` | 172 | 116 | 5 | 0 | 51 |
| `data/` | 162 | 54 | 1 | 0 | 107 |
| `automation/` | 75 | 49 | 0 | 0 | 26 |
| `security/` | 20 | 7 | 0 | 0 | 13 |
| `studio/` | 27 | 27 | 0 | 0 | 0 |
| **total** | **456** | **253** | **6** | **0** | **197** |

## File-level triage — site counts

Object sites per file: every `z.object(` / `strictObject(` / `z.strictObject(` /
`z.looseObject(` CALL, read from the AST. A file with zero sites has nothing to
classify and is not listed (it becomes reportable the day it grows its first site).

### `ui/` — sites

| File | Sites |
|---|---|
| `action-params.zod.ts` | 1 |
| `action.zod.ts` | 8 |
| `app.zod.ts` | 18 |
| `bulk-action.zod.ts` | 3 |
| `chart.zod.ts` | 8 |
| `component.zod.ts` | 30 |
| `dashboard.zod.ts` | 11 |
| `dataset.zod.ts` | 4 |
| `i18n.zod.ts` | 6 |
| `page.zod.ts` | 7 |
| `report.zod.ts` | 3 |
| `responsive.zod.ts` | 4 |
| `sharing.zod.ts` | 1 |
| `theme.zod.ts` | 6 |
| `view.zod.ts` | 53 |
| `widget.zod.ts` | 9 |
| **total** | **172** |

### `data/` — sites

| File | Sites |
|---|---|
| `analytics.zod.ts` | 8 |
| `data-engine.zod.ts` | 13 |
| `datasource.zod.ts` | 6 |
| `document.zod.ts` | 8 |
| `driver-nosql.zod.ts` | 10 |
| `driver-sql.zod.ts` | 2 |
| `driver.zod.ts` | 9 |
| `driver/memory.zod.ts` | 6 |
| `driver/mongo.zod.ts` | 1 |
| `driver/mysql.zod.ts` | 1 |
| `driver/postgres.zod.ts` | 1 |
| `driver/sqlite.zod.ts` | 2 |
| `external-catalog.zod.ts` | 4 |
| `external-lookup.zod.ts` | 12 |
| `field-value.zod.ts` | 2 |
| `field.zod.ts` | 11 |
| `filter.zod.ts` | 11 |
| `hook-body.zod.ts` | 2 |
| `hook.zod.ts` | 6 |
| `mapping.zod.ts` | 3 |
| `object.zod.ts` | 20 |
| `query.zod.ts` | 5 |
| `seed-loader.zod.ts` | 12 |
| `seed.zod.ts` | 1 |
| `validation.zod.ts` | 6 |
| **total** | **162** |

### `automation/` — sites

| File | Sites |
|---|---|
| `approval.zod.ts` | 4 |
| `bpmn-interop.zod.ts` | 5 |
| `builtin-node-config.zod.ts` | 8 |
| `control-flow.zod.ts` | 5 |
| `etl.zod.ts` | 10 |
| `execution.zod.ts` | 13 |
| `flow-function.zod.ts` | 1 |
| `flow.zod.ts` | 11 |
| `io-node-config.zod.ts` | 2 |
| `node-executor.zod.ts` | 4 |
| `schemaless-node-config.zod.ts` | 4 |
| `state-machine.zod.ts` | 6 |
| `time-relative-trigger.zod.ts` | 1 |
| `webhook.zod.ts` | 1 |
| **total** | **75** |

### `security/` — sites

| File | Sites |
|---|---|
| `explain.zod.ts` | 11 |
| `permission.zod.ts` | 4 |
| `rls.zod.ts` | 3 |
| `sharing.zod.ts` | 2 |
| **total** | **20** |

### `studio/` — sites

| File | Sites |
|---|---|
| `flow-builder.zod.ts` | 7 |
| `object-designer.zod.ts` | 12 |
| `plugin.zod.ts` | 8 |
| **total** | **27** |

## Remaining strip sites — the batch-planning map

Per file, how many of its sites still silently discard unknown keys. The `Class`
column that decides the bucket split is hand-written in the ledger; the arithmetic
over it is here.

### `ui/` — open

**51 strip of 172**, in 7 file(s).

| File | Strip | Sites |
|---|---|---|
| `action-params.zod.ts` | 1 | 1 |
| `app.zod.ts` | 1 | 18 |
| `chart.zod.ts` | 2 | 8 |
| `component.zod.ts` | 30 | 30 |
| `i18n.zod.ts` | 5 | 6 |
| `view.zod.ts` | 3 | 53 |
| `widget.zod.ts` | 9 | 9 |
| **total** | **51** | **172** |

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 34 |
| unresolved — needs a per-schema verdict | 0 |
| wire / open — out of forced scope | 3 |
| no door — no carrier, ADR-0049 territory | 14 |
| no gate — carrier live, no parse | 0 |

### `data/` — open

**107 strip of 162**, in 16 file(s).

| File | Strip | Sites |
|---|---|---|
| `analytics.zod.ts` | 8 | 8 |
| `data-engine.zod.ts` | 13 | 13 |
| `document.zod.ts` | 8 | 8 |
| `driver-nosql.zod.ts` | 10 | 10 |
| `driver-sql.zod.ts` | 2 | 2 |
| `driver.zod.ts` | 9 | 9 |
| `driver/memory.zod.ts` | 5 | 6 |
| `external-catalog.zod.ts` | 4 | 4 |
| `external-lookup.zod.ts` | 12 | 12 |
| `field-value.zod.ts` | 1 | 2 |
| `field.zod.ts` | 3 | 11 |
| `filter.zod.ts` | 11 | 11 |
| `hook.zod.ts` | 4 | 6 |
| `object.zod.ts` | 1 | 20 |
| `query.zod.ts` | 4 | 5 |
| `seed-loader.zod.ts` | 12 | 12 |
| **total** | **107** | **162** |

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 9 |
| unresolved — needs a per-schema verdict | 33 |
| wire / open — out of forced scope | 65 |
| no door — no carrier, ADR-0049 territory | 0 |
| no gate — carrier live, no parse | 0 |

### `automation/` — open

**26 strip of 75**, in 5 file(s).

| File | Strip | Sites |
|---|---|---|
| `bpmn-interop.zod.ts` | 5 | 5 |
| `etl.zod.ts` | 3 | 10 |
| `execution.zod.ts` | 13 | 13 |
| `flow.zod.ts` | 1 | 11 |
| `node-executor.zod.ts` | 4 | 4 |
| **total** | **26** | **75** |

| Bucket | Sites |
|---|---|
| authorable — the ruling's forced scope | 0 |
| unresolved — needs a per-schema verdict | 0 |
| wire / open — out of forced scope | 26 |
| no door — no carrier, ADR-0049 territory | 0 |
| no gate — carrier live, no parse | 0 |

### `security/` — open

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

### `studio/` — open

**0 strip of 27**, in 0 file(s).

This directory is closed.

## Other directories (untriaged)

Site totals only — these directories are classified coarsely in the ledger, per
directory rather than per file.

| Dir | Sites |
|---|---|
| `ai/` | 77 |
| `api/` | 396 |
| `cloud/` | 83 |
| `identity/` | 33 |
| `integration/` | 10 |
| `kernel/` | 319 |
| `qa/` | 6 |
| `shared/` | 25 |
| `system/` | 366 |
