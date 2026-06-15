# Audit: DatasetSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ui/dataset.zod.ts`. **Consumers**: framework `service-analytics` (`dataset-compiler`/`dataset-executor`/`analytics-service`), objectui `DatasetWidget`/`DatasetReportRenderer`/`DatasetDefaultInspector`.

## LIVE & well-wired (the analytics query path)
Dataset: `name`, `label`, `object` (FROM), `include` (join allowlist), `filter`, `dimensions[]`, `measures[]`. Dimension: `name`, `field`, `type`, `dateGranularity`. Measure: `name`, `aggregate`, `field`, `filter`, `format`, `label`, `derived{op,of}`. Evidence: `dataset-compiler.ts:137-191`, `dataset-executor.ts:184-278`, `analytics-service.ts:464-472`. Report/widget renderers bind by **name only** + a `{dimensions,measures}` selection → all sub-prop resolution happens server-side in the compiler/executor.

## DEAD
- **`description`** (dataset) — only a Studio form field; no runtime reader.
- **`certified`** (measure) — has a Studio checkbox (`DatasetDefaultInspector.tsx:160`) but **no runtime gate** (aspirational ADR-0021 governance checkpoint with zero enforcement).

## PARTIAL / drift
- **Dimension `label`** is compiled but surfaces only via `getMeta` discovery titles; charts render the raw server-resolved dimension *value*, never the declared `label`. (Measure `label` fully flows to the renderer.)
- **Dual vocabulary**: spec says `measures`/`dimensions`; presentations select via `values` (measures) and `rows`/`columns` (dimensions); the compile renames `DatasetMeasure→Metric`, `aggregate→type`. Two parallel naming layers (ADR-0021 Phase-1).

## 🟠 Studio under-covers the live schema (authoring gap)
`DatasetDefaultInspector` edits only name/label/description/object/include + dim(name/field/type) + measure(name/aggregate/field/certified). It exposes **no editor** for the LIVE, behavior-changing props: dataset `filter`, measure `filter`, measure `format`, measure `derived`, dimension `dateGranularity`, dim/measure `label`. These must be hand-authored in `.dataset.ts`.

## Recommendation
Remove `description`/`certified` or wire them. Surface the live-but-uneditable props in the Studio dataset designer. Reconcile the measures/dimensions ↔ values/rows/columns vocabulary in one documented place.
