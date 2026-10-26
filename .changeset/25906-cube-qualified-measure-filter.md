---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: a filtered dataset measure asked on the cube door as `CUBE.MEASURE`, the name `GET /analytics/meta` lists, applies its filter, as the bare name always did

A registered dataset's measure can carry its own `filter`, for example `won_amount` summing `amount` only where `stage` is `won`. `GET /analytics/meta` lists every cube member as `CUBE.MEASURE` (`sales.won_amount`), and `POST /analytics/query` accepts that spelling. The measure itself resolved under both spellings, but its filter was looked up by the spelling as asked, so the listed one missed it. `measures: ['sales.won_amount']` ran `SUM(amount)`: the total of every deal, under the won-deals measure's name, with no error. That happened on both strategies (native SQL and the ObjectQL aggregate) and in the dry-run statement echo.

Every reader of a measure's scoped filter now resolves the name through one rule, the one the duration measure's lookup already used: the bare name, or the name without its own cube's qualifier. The listed spelling answers the same conditional aggregate and binds the same values as the bare one, under the column name asked. The native strategy's routing declines (a nested-relation condition, a JSON-stored comparison on an unnamed dialect) read the same filter, so they route the qualified spelling as they route the bare one. Another dotted prefix keys nothing, as before. Queries through `POST /analytics/dataset/query` were never affected: that path builds bare names.

Clause-②: no (narrowing) — the field-level read gate now judges the fields of the measure's filter under the qualified spelling too. A caller who may not read a field that a filtered measure's filter names was refused `403 PERMISSION_DENIED` for the bare spelling and answered (with the unfiltered number) for the qualified one. It is now refused for both. Nothing is widened.

Metadata-protocol: none (how the analytics query door resolves a requested member name; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is how the analytics query door reads a filtered measure asked under its listed `CUBE.MEASURE` spelling: its filter is applied, and the read gate judges the filter's fields. The remedy for a caller now refused is a permission grant or a different measure, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that asked a filtered measure under its `CUBE.MEASURE` spelling: the number changes, and a caller who may not read the filter's fields is now refused. Shipped as `patch` because the metadata protocol does not move.

- **Before.** `measures: ['sales.won_amount']` aggregated every row, ignoring the measure's filter, and the read gate did not judge the filter's fields.
- **Now.** It answers what `measures: ['won_amount']` answers: the filtered aggregate, or `403 PERMISSION_DENIED` naming the unreadable field.
- **Fix.** Nothing to change for a caller that wanted the measure as declared. A caller that relied on the unfiltered total asks for an unfiltered measure instead.
