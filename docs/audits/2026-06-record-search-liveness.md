# Audit: Record search liveness & architecture

**Date**: 2026-06-21
**Scope**: the end-to-end **record search** capability — the generic data-query `$search` / `FullTextSearchSchema` and every surface that invokes it, across framework (spec, objectql, rest, drivers, services) and objectui (lookup picker, list view, command palette).
**Method**: cross-reference each search surface's definition against its **actual consumer** (`file:line`) in two layers — framework runtime and objectui renderers. **LIVE** = a consumer reads it and changes behaviour; **DEAD** = parsed/sent but no executor acts on it → a silent no-op for authors/callers. Browser observation is deliberately *not* the signal (tiny datasets make a no-op look like a working search).

> Evidence catalog intended to seed an ADR (record search architecture). It states what is wired; the decision lives in **ADR-0061**.

## Headline

Record search is a **declared-but-unenforced** capability (cf. ADR-0049). `$search` is defined in the spec and **sent by every client surface**, but **no driver or engine executes it** — it is a silent no-op for generic objects. The only server path that actually filters is the public-form picker. Meanwhile `$searchFields` is already sent by the client but is undocumented and unhonored (drift), and three overlapping object/view search-metadata shapes exist with **zero** data-layer consumers.

| Bucket | State |
|---|---|
| `$search` execution (engine + drivers) | **DEAD** — no-op |
| `$searchFields` (client → server) | **DRIFT** — sent, undocumented, unhonored |
| object / view search metadata | **PARTIAL** — admin UI only; data layer ignores |
| public-form lookup picker | **LIVE** — the only working path |
| global `/search` (`searchAll`) | **PLANNED** — 501 |
| knowledge / RAG / vector | **LIVE but separate** (documents, not CRUD) |
| external FTS engines | **PLANNED** — schema only |

## 1. Generic `$search` — DEAD
- **Defined**: `packages/spec/src/data/query.zod.ts:454` `FullTextSearchSchema { query, fields, fuzzy, operator, boost, minScore, language, highlight }`; wired into `BaseQuerySchema` at `:525`.
- **Not executed**: no path in `packages/objectql/src/engine.ts` or `protocol.ts`; `driver-sql` `fullTextSearch: false` (`packages/plugins/driver-sql/src/sql-driver.ts:166`); `driver-memory` `fullTextSearch: false` (`memory-driver.ts:136`); mongodb no `$text`. → `$search` returns rows **unfiltered**.

## 2. `$searchFields` — DRIFT
- objectui ListView sends `$searchFields: schema.searchableFields` (`packages/plugin-list/src/ListView.tsx:1001`) — **not** in the `QueryParams` contract (`packages/types/src/data.ts`), and the backend does not honor it.

## 3. Object / view search metadata — PARTIAL
- `object.searchable` boolean (`object.zod.ts:52`) — consumed by metadata-admin UI + the command-palette object gate; **not** the data layer.
- `object.search` (`SearchConfigSchema`, `object.zod.ts:113`) — `fields`/`displayFields`/`filters`; **no runtime consumer**.
- `view.searchableFields` (`view.zod.ts:522`) — UI input control + ListView; not the data layer.
- field-level `searchable` — **DEAD** (per `archive/2026-06/2026-06-fieldschema-property-liveness.md`).

## 4. Lookup search (objectui) — sends `$search`, gets a no-op
- `LookupField.tsx:311` / `RecordPickerDialog.tsx:451` — bare `$search`. The picker "works" visually only because datasets are tiny; there is **no server filtering**.
- `$filter` `$contains` IS live (user filter bar / `lookupFilters`) — driver-sql implements `$or`/`$contains` (`sql-driver.ts:1919/1962`). This is the lever the ADR's Tier 1 builds on.

## 5. Global search — client fan-out + PLANNED server
- CommandPalette → `useRecordSearch` (`packages/react/src/hooks/useRecordSearch.ts:235`) fans out bare `$search` per object and ranks **client-side** (`scoreHit`); object gate via `searchable !== false` (`:195`).
- Server `GET /search` (`searchAll`) skeleton (`packages/rest/src/rest-server.ts:3309`) → 501.

## 6. Public-form picker — LIVE (only working path)
- `GET /forms/:slug/lookup/:field` (`rest-server.ts:3751`) — `publicPicker` projection + base `filter` + `maxResults` ≤ 50 (anti-enumeration).

## 7. Heavier search — separate / planned
- `service-knowledge` `IKnowledgeService` (RAG) — LIVE but **document-scoped**, not object CRUD.
- vector search — PLANNED (`driver.zod.ts:236`).
- external engines (Elasticsearch / Algolia / MeiliSearch / Typesense) — declared in `system/search-engine.zod`, no runtime.

## Drift / duplication (why "consistency" is itself a requirement)
- ListView sends `$searchFields`; lookup & command-palette don't → three surfaces, three behaviours.
- LookupField carries a hardcoded client-side `label + description` local filter (static-options path).
- Three object/view search-metadata shapes, **zero** data-layer consumers.

## Recommendation
Treat as an **enforce-or-remove** (ADR-0049) case: either wire `$search` end-to-end through a single **metadata-driven server resolver** (recommended) or mark it experimental. The decision, default behaviour, phasing, and rejected alternatives are in **ADR-0061**.
