# ADR-0098: Pinyin Search via a Locale-Gated Companion Column

- **Status**: Accepted
- **Date**: 2026-07-16
- **Issue**: #2486
- **Extends**: ADR-0061 (record search architecture — purely additive), ADR-0045 (additive materialization), ADR-0079 (display-name contract)

## Context

Pinyin search is a cross-cutting requirement for Chinese deployments: user
pickers (`sys_user`), accounts, products, departments — any object with CJK
names — must be findable by typing full pinyin (`zhangwei`) or initials
(`zw`). ADR-0061 Tier-1 `$search` expands to `$contains` over source columns,
which can never match: the stored value is the CJK original. Hand-rolling
denormalized pinyin columns per object would copy the same hack N times.

Database tokenizers were investigated and rejected: Turso Cloud does not load
traditional C extensions (no `simple` pinyin tokenizer), neither SQLite FTS5
nor Turso's Tantivy engine ships native pinyin, and each dialect's FTS is
mutually incompatible (FTS5 / tsvector·pg_trgm / Tantivy). A denormalized
companion column + `$contains` is dialect- and engine-agnostic, and a future
Tier-2 native FTS simply indexes it as one more column.

Of the four input shapes against CJK records, only two need anything new:
CJK text and other-field originals (email, codes) already hit source columns
via `$contains`. Full pinyin and initials do not. So the entire net increment
is: **one normalized companion column for the name field, OR-ed in at query
time**.

## Decision

1. **Locale-gated platform switch, no field metadata.**
   `OS_SEARCH_PINYIN_ENABLED` (resolved by `resolveSearchPinyinEnabled()` in
   `@objectstack/types`) gates the feature end-to-end. When unset, the CLI
   boot path derives the default from the stack's configured locales (any
   `zh-*` → on) and stamps the decision back into the env var so every
   consumer — the per-engine `SchemaRegistry` and the plugin gate — reads the
   same single decision. No field-level `pinyin` marker exists, so there is
   no declared-but-unenforced dead metadata (ADR-0049) and no half-state
   where a field "pretends" to support pinyin.

2. **Materialization set ≠ search set: one column per object.** Only the
   ADR-0079 display/name field (`resolveDisplayField`) feeds the hidden
   companion column `__search` — `provisionSearchCompanion` in
   `packages/objectql/src/search-companion.ts`, invoked from
   `SchemaRegistry.registerObject` right after `provisionPrimary`. The column
   is `hidden` / `readonly` / `system` / `searchable: false` / `index: true`;
   migration is a plain additive column (ADR-0045). `searchableFields` and
   the auto-default are untouched — text search stays wide via source
   columns, pinyin materialization stays narrow.

3. **One blob recalls both shapes.** The column stores full pinyin AND
   initials (`"张伟"` → `"zhangwei zw"`), so a single `$contains` recalls
   `zhang`/`wei`/`zhangwei` (full-form substrings) and `zw` (initials).
   Relevance ranking (full-pinyin first) and short-initial noise guards are
   Tier-2 (native FTS) — deliberately out of scope, hence one column, not two.

4. **Plugin fills, never declares** (the `plugin-sharing` primary-BU
   projection pattern). `@objectstack/plugin-pinyin-search` binds global
   `beforeInsert`/`beforeUpdate` hooks that recompute the blob (lazy-loaded
   `pinyin-pro`, default polyphone heuristics) **only when the source field is
   in the write** — no write amplification. A non-CJK new value clears the
   blob (no stale recall).

5. **Query-time is purely additive.** `expandSearchToFilter`
   (`packages/objectql/src/search-filter.ts`) ORs
   `{ __search: { $contains: term } }` into each latin term's clause when the
   object carries the column. `resolveSearchFields` is unchanged; the
   companion is invisible to `$searchFields` overrides and clients. CJK terms
   skip the clause (they hit source columns). `$or` + `$contains` are
   supported by every driver — zero driver changes.

6. **Security guardrail (ADR-0061 D5 extended).** Only fields readable by
   every accessor may feed the shared companion: fields with
   `requiredPermissions` (FLS), `hidden` fields, and secret/virtual types are
   excluded at the single eligibility gate (`isCompanionSourceEligible`) —
   otherwise "which search hits" becomes an FLS-bypass inference oracle.
   Fail-closed, not author-remembered.

7. **Write-path fallback.** Hook-bypassing writes (bulk import, direct
   migration) leave the blob empty → `backfillSearchCompanion` runs once per
   boot (`kernel:bootstrapped`, paged, idempotent) and
   `rebuildSearchCompanion` is the explicit reconcile/rebuild entry.

## Generalization seam

The companion is one instance of "search-normalization companion":
`SEARCH_COMPANION_NORMALIZERS = ['pinyin']` names the applied normalizers.
Future normalizers (simplified/traditional conversion, width folding, accent
folding) extend the same list and column; only pinyin is implemented.

## Non-goals

- Relevance ranking, typo tolerance, whole-word guards → Tier-2 (native FTS).
- Materializing non-name fields or a search blob; changing
  `searchableFields`/auto-default behavior.
- Surname polyphone dictionaries (P2; `pinyin-pro` heuristics accepted).
- Turso/SQLite tokenizers or loadable extensions.
