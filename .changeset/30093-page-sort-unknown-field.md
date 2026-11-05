---
'@objectstack/lint': minor
---

fix(lint)!: a stored page sort naming a field its object lacks is refused by `os validate` and at the page publish door (`page-field-unknown`, error), on every page sort slot (#30093)

Clause-②: no (narrowing) — an unknown sort field on a page slot moves from silent or warning to error: `os validate` / `os build` / `os lint` and the `page` publish door refuse a page sort they accepted before.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach no page sort that names a field the object lacks, and nothing there describes an unknown page sort as a warning; the verdict and its fix line name the field, the object and the nearest declared field.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: every page sort slot keeps its shape and meaning, and the build and the page publish door now give an unknown field there the verdict a list view sort already gets. A refused name never sorted anything (the list door answered every read 400 INVALID_SORT), so there is no rewrite that keeps what the author meant; the author names a real field, and the refusal says which. -->

**BREAKING** accept-set narrowing at the page publish door (`PUT /api/v1/meta/page/NAME`; Studio, REST and MCP authors) and in `os validate` / `os build` / `os lint`.

- **Before.** A page sort naming a field the object does not have saved green, and its first read, and every read after it, answered `400 INVALID_SORT` at the list door. A list page's `interfaceConfig.sort` and a `record:related_list` block's `sort` drew a `page-field-unknown` warning on the CLI alone; an element `dataSource.sort`, a related list's `parentDataSource.sort`, an app page's `record.sort` and the own `sort` of a `record:line_items`, `list-view` or `object-*` block were read by nothing.
- **Now.** Every one of those slots is judged by `validateSortableFields`, the reference-integrity member the page publish door already runs, and an unknown name is `page-field-unknown` at `error`, at the slot's path, bound to the object the slot's renderer reads (`dataSource.object`, else the block's object prop; `interfaceConfig.source`, else the page's `object`; `parentDataSource.object`; `record.object`). The page door refuses it `422 INVALID_METADATA`. A registry-injected column on an `external` object is `page-field-unprovisioned` at `warning`, as before. `validatePageFieldBindings` no longer reads a page sort, so each slot has one reader.
- **Not judged.** A dotted relationship path (the list door refuses it as its own verdict), a system column such as `created_at`, an object the stack (or the publish snapshot) does not carry, and an object with no field map.
- **Not changed.** A stored page already carrying such a sort keeps loading; only its next save is judged, and its read answers 400 as it did before.

**What an author does.** Name a field the object declares, or add the field to the object. A refused name never sorted the page, so there is nothing to keep.
