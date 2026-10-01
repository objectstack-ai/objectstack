---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: an inline dataset's own caller-supplied `field` text that is not a column reference is refused at the analytics dataset door

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) an inline (caller-POSTed) dataset's own dimension or measure `field` text that is not a column reference (a field, a relationship path ending in one, or `*`) is refused at the analytics dataset door, before the dataset is compiled and before any strategy runs, for every caller and whether or not a security service is wired, through the field-read gate's existing judge and envelope (`PERMISSION_DENIED` / 403). No authorable key, spelling, export or stored shape moves, and no stored row is read differently by any metadata consumer; the published surface gains and loses nothing. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a caller-supplied dataset `field` (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). A caller names a column instead of writing an expression, which is ADR-0021's author surface already ("zero raw expressions"), so there is no FROM → TO mapping to carry. -->

**BREAKING**: this narrows what the analytics dataset door accepts. An inline dataset whose dimension or measure `field` is not a column reference is now refused with `403 PERMISSION_DENIED` instead of being evaluated. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What changes.** The service compiles an inline dataset into a cube whose members read as declared, so a dimension or measure whose `field` was a raw expression resolved to a declared cube member and was left to the field-level read gate, which stands down with no security service and on an object its reader answers `undefined` for; in those tiers the expression reached the native statement as written. The dataset's own `field` text is now judged at the dataset door, before compile and before any strategy runs, through the field-read gate's existing judge (`PERMISSION_DENIED` / 403, naming the member and never the expression text), for every caller, admin included, and with or without a security service. There is no new error code and no new admission module.

**What stays answerable.** Every inline dataset whose fields are columns or relationship paths is unchanged. A registered dataset's own field text is author text, queried by cube name and left to the existing gates. The dataset's own filter, the selection's runtime filter and cube-query members are lowered into the compiled query and already judged on the query path, so they are unchanged.
