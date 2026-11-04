---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint)!: a stored sort naming a field that declares `sortable: false` is refused by `os validate` and at publish, judged by the same sortability projection the Data API list door refuses it by — on a list view and on every stored page sort (#30023)

Clause-②: yes (narrowing) — `sort-field-unsortable` (error) now also fires on a sort naming a field whose author declared `sortable: false`, on the list-view rungs it already walked and on every stored page sort it did not walk before (a block's own `sort`, every element `dataSource.sort`, a related list's `parentDataSource.sort`, a list page's `interfaceConfig.sort`, an app page's `record.sort`, where a `formula` sort is now refused too), so `os validate` / `os build` / `os lint` and the `page` and `view` publish doors refuse metadata they used to accept. The widening half: `@objectstack/lint` exports `indexObjectSortability`, `PAGE_BLOCK_SORT_OBJECT_PROP` and the `SortabilityFields` type, and `checkSortDeclaration` takes an optional trailing `sortability` index.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` names no `sortable` field key and no page or view `sort` rule; `content/docs/**` already teaches `sortable: false` as "do not allow sorting by this field". The prescription ships in the finding's fix line, `os explain sort-field-unsortable` and the upgrade-guide entry.

<!-- adr-0087: not-required (already-registered field-sortable-false-sort-refused) the entry already prescribes this change: it names the stored sorts this rule now judges and, from this release, names `os validate` and the publish door as where an affected view or page surfaces; its surface and acceptance criteria are widened here to every stored page sort -->

**BREAKING** accept-set narrowing at authoring (`@objectstack/lint`): a stored sort the Data API list door refuses is refused before it is stored.

- **Before.** A list view whose `sort` named a field marked `sortable: false` passed `os validate` and the `PUT /api/v1/meta/view` door, then answered `400 INVALID_SORT` on its first fetch and on every fetch after it. No page sort was judged for sortability at all: a `record:related_list`, `record:line_items`, `list-view` or `object-*` block sorting by such a field (or by a `formula` field), an element `dataSource.sort`, a related list's `parentDataSource.sort`, a list page's `interfaceConfig.sort` and an app page's `record.sort` all saved green and failed at read.
- **Now.** `validateSortableFields` judges each of those positions by `resolveObjectSortability`, the projection the list door refuses by, and reports `sort-field-unsortable` at `error` with the door's own clause ("a field on object X that declares `sortable: false`") at the slot's path. The reference-integrity suite now runs on a `page` write for this one member, so the Studio, REST `/meta` and MCP page doors give the same refusal (422). Only the literal `false` counts: a field with no `sortable` key, or `sortable: true`, sorts as before. A `formula` field also marked `sortable: false` keeps its virtual-field verdict. Existence on page sorts stays `page-field-unknown`.
- **Not changed.** A stored view or page already carrying such a sort keeps loading and serving; only its next save is judged, and its first fetch still answers 400 as it did since the list door started refusing it.

**The remedy.** Sort by another field, or remove `sortable: false` from the field to make it sortable.

**Supersedes, in the same release.** The `@objectstack/spec` / `@objectstack/metadata-protocol` / `@objectstack/mcp` note for #29896 says "Lint does not yet judge these at authoring." From this release it does: `os validate` and the publish doors refuse every stored sort that note lists, and the stored page sorts it did not list.
