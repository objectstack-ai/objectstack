# ADR-0061: Record Search Architecture — metadata-driven `$search` resolution

**Status**: Accepted (2026-06-21; Tier 1) — implemented and conformance-closed per this ADR's own bar: server-resolved `$search` executor (`objectql/src/search-filter.ts` + engine wiring), `object.searchableFields` + `$searchFields` narrowing, select label→value mapping; **`search-conformance` ledger** (`dogfood/test/search-conformance.ledger.ts`, ADR-0060 `checkLedger`, proof-required) + **dogfood multi-field HTTP proof** (`showcase-search.dogfood.test.ts`: "retail"→Northwind via `industry`, label mapping, narrowing, terms-AND). Tier 2 (FTS / relevance / external engines) remains deferred — add its ledger row with a proof when a driver ships `fullTextSearch: true`.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: ADR-0045 (additive materialization & visibility gate — search must be visibility-aware), ADR-0049 (enforce-or-remove / no unenforced declaration), ADR-0054 (runtime proof per enforced surface), ADR-0060 (conformance ledger as a platform pattern)
**Amended by**: [#29008](https://github.com/objectstack-ai/objectstack/issues/29008) (2026-11-02, ruling record [6573569376](https://github.com/objectstack-ai/objectstack/issues/29008#issuecomment-6573569376), letter A; landed by PR #29385, `29c70cac`) — D2's "Field-level `searchable` stays pruned" is reversed: `FieldSchema.searchable` is honoured on the auto-default branch, the "Default behaviour (normative)" field-resolution row's `auto` arm is read as widened by it, and D5 holds through the flag's hard exclusions; see the amendment note under D2.
**Consumers**: spec, objectql, driver-sql, driver-memory, driver-mongodb, rest, objectui (`fields`, `plugin-list`, `app-shell`), verify, dogfood
**References**: `docs/audits/2026-06-record-search-liveness.md`; objectui #1860 / #1863 / framework #2125 / #2128 (lookup picker UX that exposed the gap)

## TL;DR

`$search` is a textbook **declared-but-unenforced** surface: `FullTextSearchSchema` is defined and **every** client (lookup picker, list quick-search, ⌘K) sends `$search`, yet **no engine or driver executes it** — a silent no-op. Only the public-form picker actually filters; `$searchFields` is already sent by the client but undocumented and unhonored; three object/view search-metadata shapes have zero data-layer consumers.

Decision: **enforce** record search as one **metadata-driven, server-resolved** capability. The client sends only the query text; the **server resolves which fields to search from object metadata**; a **single resolver feeds all surfaces**, behind a **two-tier executor** (driver `contains` now; native FTS / external engine / relevance later). Migration is **additive** — it turns a no-op into a filter. Ship **Tier 1 + the contract + unify lookup**; defer Tier 2 (index / relevance / server `searchAll`); keep knowledge/vector a separate subsystem.

> **North star**: the client says *what to search for*; the server decides *which fields, how to rank, and what may be seen*. One contract for every surface; the executor is swappable.

## Context

### The declared-but-unenforced failure, again
ObjectStack's defining risk is not a crash but a primitive that is *declarable* yet *inert* (ADR-0049, ADR-0060). Record search is a clean instance: the `docs/audits/2026-06-record-search-liveness.md` evidence shows `$search` (`packages/spec/src/data/query.zod.ts`) parsed but executed by no driver (`driver-sql`/`memory` both `fullTextSearch: false`), so it returns rows unfiltered. AI authorship amplifies this — a model emits `searchableFields` that *looks* wired and nothing reads it.

### The requirement is platform-wide, not "lookup multi-field search"
Search surfaces, all sending the same `$search` today:
- **Lookup picker** (`fields/LookupField`, `RecordPickerDialog`) — type-ahead + dialog.
- **List quick-search** (`plugin-list/ListView`) — already sends `$searchFields` (drift).
- **Global / ⌘K** (`app-shell/CommandPalette` → `react/useRecordSearch`) — client fan-out + client ranking.
- **Public-form picker** (`packages/rest/src/rest-server.ts`) — the only working, scoped path.
- **Structured filters** (FilterUI, grid/report filter bars) — `$filter`/`$contains`, *not* full-text; out of scope here.
- **Knowledge / RAG / vector** — separate semantic subsystem; out of scope here.

Three object/view metadata shapes overlap (`object.searchable`, `object.search`, `view.searchableFields`) with no data-layer consumer — so "collapse to one source of truth" is itself a decision.

## Decision

### D1 — Contract: client sends the query; server resolves fields; `$searchFields` is a *validated override*
The default contract is `$search: string` (plus existing `$filter`/scope). **Field resolution is server-side from metadata.** `$searchFields` is **promoted into the formal `QueryParams`/`FullTextSearchSchema` contract** as an *optional* override and **the server intersects it with the object's allowed searchable set**, silently dropping disallowed fields. Client-decided fields are never the primary path and never widen beyond what metadata permits.

### D2 — Single source of truth for searchable fields
- `object.searchableFields: string[]` is the **canonical** list (shorthand that feeds `object.search.fields`).
- `object.searchable: boolean` is retained as the **on/off gate** (does this object participate in search at all) — orthogonal to *which* fields.
- `view.searchableFields` is a **narrowing override** for a specific surface.
- **Resolution order**: validated `$searchFields` → `view.searchableFields` → `object.searchableFields` → **auto-default** (the name/title field + short-text fields: `text`/`email`/`phone`/`url`; excluding long-text/json/secret/system).
- Collapse the duplicate field list inside `SearchConfigSchema` (it keeps only Tier-2 knobs: analyzer/boost/provider). Field-level `searchable` stays pruned.
  > **Amendment note (2026-11-02, [#29008](https://github.com/objectstack-ai/objectstack/issues/29008) — ruling record
  > [6573569376](https://github.com/objectstack-ai/objectstack/issues/29008#issuecomment-6573569376), letter A; landed by
  > PR #29385, `29c70cac`).** "Field-level `searchable` stays pruned" is reversed: `FieldSchema.searchable` is honoured, not
  > retired, on the **auto-default** branch. With no `object.searchableFields` declared, the resolved set is the type-based
  > auto-default plus every field marked `searchable: true`, of any type except the hard exclusions `secret` / `password` /
  > `vector` (`packages/spec/src/data/search-fields.ts#SEARCH_FLAG_EXCLUDED_TYPES`) and a virtual `formula` field, which
  > has no stored column to scan. The flag is asked before the auto-default's own name, `hidden` and type exclusions
  > (`packages/spec/src/data/search-fields.ts#admittedBySearchableFlag`), so a flagged hidden field or a flagged
  > system-named column joins too; a field whose type is unreadable is not admitted. A declared `searchableFields` stays
  > the **whole** set and the flag is not read on that branch
  > (`packages/spec/src/data/search-fields.ts#resolveSearchFieldResolution`). The `$searchFields` ingress allow-list is
  > this same resolution (`packages/metadata-protocol/src/protocol-query-validation.ts#assertSearchFieldsAreSearchable`),
  > so naming a flagged field is accepted as a D1 override, and a flagged field of a hard-excluded type is still refused
  > `400 INVALID_FIELD`; a field declared `internal: true` (#22646 — ADR-0100's third credential channel, an
  > auth-subsystem one-way hash on a `text` column) is refused at that door before the resolver runs, flag or no flag.
  > The key defaults to `false`, and `false` removes nothing the type-based default already scans:
  > the flag widens the auto-default and never narrows it. The "Default behaviour (normative)" table's field-resolution
  > row is read with its `auto` arm widened the same way — `auto (name + short-text + every field marked searchable: true
  > outside the hard exclusions)`; the row itself is left as written. **D5 re-read:** "Secret / encrypted / PII fields are
  > never searchable (excluded from default, rejected from override)" stays true under the flag, and the hard exclusions
  > are what keep it so: `SEARCH_FLAG_EXCLUDED_TYPES` covers every masked-on-read credential type
  > (`packages/spec/src/data/masked-field-types.ts#MASKED_ON_READ_FIELD_TYPES` — `secret` and `password`; `encrypted` is
  > not a `FieldType`), so such a column marked `searchable: true` is neither scanned nor accepted as an override. The
  > third channel, an `internal: true` column, holds by the pre-existing withhold rather than by
  > `SEARCH_FLAG_EXCLUDED_TYPES`: the engine strips `internal: true` and credential fields from the field map before it
  > resolves the set (`packages/objectql/src/engine.ts#scanFields`, #22646), and the door refuses an explicit override
  > naming one before the resolver runs (above), so the flag never reaches it. The resolver reads no PII marker, before or
  > after this ruling, and the flag changes which fields resolve, not how a search executes: it still runs through the
  > gated `find()` pipeline, so the rest of D5 is untouched.

### D3 — Two-tier executor behind one `$search` API
- **Tier 1 (this phase)**: the engine expands `$search` into a cross-field predicate pushed to the driver — `driver-sql` reuses existing `$or` + `$contains` (ILIKE, wildcard-escaped); `driver-memory` does in-memory `contains`. New driver capability `textSearch: true`. Matching is **case-insensitive; terms AND-ed, fields OR-ed** (each term must hit some field) — i.e. `FullTextSearchSchema.operator` default. Default is **contains** (not prefix). When a driver lacks `textSearch`, the **engine applies a bounded in-memory fallback** (degraded scale, logged) so search works everywhere.
- **Tier 2 (deferred)**: `pg_trgm` (makes `contains` indexable) / `tsvector` ranked full-text and the external providers in `system/search-engine.zod`; relevance / `boost` / `minScore` / `fuzzy` live here.

### D4 — label↔value and ranking resolve server-side
- For `select`/`status` fields the resolver maps the query to **option values via their (i18n) labels** before matching (Tier 1 — metadata is in-object and cheap). For `lookup`/`reference` fields, searching the related display name needs a join → **Tier 2** (or a denormalized display column).
- **Per-object relevance ranking is server-side (Tier 2)**; the client retains only the **cross-object merge sort** for global fan-out (unavoidable without a unified index).

### D5 — Security: search is a thin layer over the gated `find()`
Search runs through the **same query pipeline as `find()`** — RLS, field-level security, and row filters apply automatically; **no separate unguarded search path**. Results respect the **ADR-0045 materialization/visibility gate** (draft vs published). The `$searchFields` override is subset-validated (D1). **Secret / encrypted / PII fields are never searchable** (excluded from default, rejected from override). Public/anonymous search keeps the existing `publicPicker` model (projection + `maxResults` ≤ 50, no enumeration). LIKE wildcards are escaped (driver-sql already does).

> **Note (2026-10-01) — anonymous search retired.** The `publicPicker` model the sentence above keeps is retired by the maintainer's ruling E on [#21079](https://github.com/objectstack-ai/objectstack/issues/21079) ([comment 5933054144](https://github.com/objectstack-ai/objectstack/issues/21079#issuecomment-5933054144), 2026-10-01), which reverses the [#7467](https://github.com/objectstack-ai/objectstack/issues/7467) model (declare `publicPicker`). Anonymous public forms no longer take lookup, `master_detail` or `user` fields: the public-form resolve route leaves them off the anonymous rendering unconditionally, the anonymous record-search route `GET /forms/:slug/lookup/:field` is deleted, and `publicPicker` is a `retiredKey()` tombstone under ADR-0087 D2 (immediate retirement). So there is no public/anonymous record search; the rest of D5 stands. The retirement is [#21180](https://github.com/objectstack-ai/objectstack/issues/21180).

### D6 — Global search: fan-out now, unified `searchAll` is Tier 2
Global search this phase = **client fan-out over the per-object Tier-1 resolver** (CommandPalette already fans out; it only needs per-object search to actually filter) — zero new server surface. The unified server `searchAll` with cross-object relevance is **Tier 2** (it needs a unified index to rank well). **Knowledge/vector stays a separate subsystem**; "blended" record+knowledge search is future and out of scope, but API-compatible.

### D7 — Migration: one resolver, additive rollout
All surfaces converge on `$search` (+ validated `$searchFields`); client-side field-guessing and the lookup's hardcoded `label+description` local filter are removed; CommandPalette keeps only its cross-object merge. Because every surface **already sends `$search` (today a no-op)**, enabling server execution is **backward-compatible** — it converts a no-op into a filter.

### Default behaviour (normative)
| Dimension | Default |
|---|---|
| Client sends | `$search` string (+ optional validated `$searchFields`) |
| Field resolution order | `$searchFields` (validated) → view → `object.searchableFields` → auto (name + short-text) |
| Matching | case-insensitive; terms AND-ed, fields OR-ed; `contains` |
| `select`/`status` | query mapped to option values via labels (Tier 1) |
| Ranking | per-object server-side (Tier 2); cross-object merge client-side |
| Security | over RLS + ADR-0045 visibility; secret/PII never searchable; override subset-validated |
| Execution | Tier 1 driver `contains` + engine in-memory fallback; Tier 2 trigram/FTS/external |

> **Amended (2026-11-02, [#29008](https://github.com/objectstack-ai/objectstack/issues/29008) — ruling record [6573569376](https://github.com/objectstack-ai/objectstack/issues/29008#issuecomment-6573569376), letter A).** The `auto` arm of the field-resolution row above also includes every field marked `searchable: true` outside the hard exclusions `secret` / `password` / `vector`; the row is left as written and the reading is set out in the amendment note under D2.

### Conformance (ADR-0060 alignment)
`$search` is **"landed" iff** a driver executes it **and** a dogfood proof asserts a multi-field match over the real HTTP API — e.g. searching `"retail"` returns an account matched by `industry`, not `name`. Add a `search-conformance` ledger entry; CI fails if `$search` is declared but no proof resolves (closing the declared-but-unenforced loop).

## Phasing
- **P1 — contract + liveness**: add `object.searchableFields`, formalize `$searchFields` in `QueryParams`/`FullTextSearchSchema`, collapse the duplicate metadata, add the conformance ledger entry.
- **P2 — executor**: objectql `$search` resolver + `driver-sql` `contains` + `driver-memory` fallback + `select` label→value; dogfood proof.
- **P3 — unify**: point lookup / list / ⌘K at the one resolver; strip client field-guessing & local filters; auto-default fields; configure flagship `searchableFields` in showcase.
- **P4 — scale (deferred)**: `pg_trgm`/`tsvector` indexes, relevance/`boost`/`fuzzy`, external engines, server `searchAll`, blended knowledge search.

## Rejected alternatives
- **Renderer-side `$or`/`$contains` across the picker's columns** — duplicates "what's searchable" in the client, leaks value↔label and storage semantics to the UI, doesn't help list/global, can't be indexed, and becomes drift the moment Tier 2 lands. Acceptable *only* as a throwaway P0 stopgap, deleted by P2.
- **Client-decided `$searchFields` as the primary mechanism** — a field-probe oracle, and the cause of today's drift; inconsistent across surfaces.
- **A bespoke per-object search service separate from `find()`** — bypasses RLS / visibility and re-implements query + security.
- **Jump straight to an external engine (ES/Algolia)** — premature at current scale; Tier 1 covers the 90% case; keep the seam for when a tenant needs it.

## Consequences
- **(+)** One consistent, secure, metadata-driven search across every surface; zero-config sensible default; additive, low-risk rollout; a clear, non-blocking path to FTS / relevance / external engines; closes a declared-but-unenforced gap with a conformance proof.
- **(−)** Tier 1 unindexed ILIKE is O(n) on large tables (mitigated by Tier-2 trigram); `lookup`/`reference` display-name search is deferred to Tier 2; cross-object relevance is limited until a unified index exists.
