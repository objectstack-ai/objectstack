---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
---

feat(spec): declare a metadata type's Studio list columns in the spec and serve them on `/meta/types`

Clause-②: yes (widening: new exported schemas and a new optional `list` on each `/meta/types` entry)
Metadata-protocol: added
Skills-docs: none — no skill under `skills/**` teaches Studio's metadata list columns; `skills/objectstack-ui/SKILL.md` names `entries[].schema` only, which is unchanged

Which columns Studio's generic list shows for a metadata type is now declared in the spec, beside the type's form, instead of in console code:

- **Spec.** `MetadataListViewSchema` is a list layout bound to the type's own schema (`data: { provider: 'schema', schemaId }`) with its `columns`; each `MetadataListColumnSchema` names a key of that schema or a dotted path into it, a header, and a cell renderer (`MetadataListCellTypeSchema`: `text`, `badge`, `boolean`, `count`, `list`, `summary`). `defineList({ schemaId, columns })` builds one and refuses an unknown renderer, an empty column list and any `ListColumn` key outside `field` / `label` / `type`. `METADATA_LIST_REGISTRY` (`@objectstack/spec/system`) is the list counterpart of `METADATA_FORM_REGISTRY`; this release declares `hook`, and a type with no entry keeps Studio's default list. A reconciliation test refuses a column naming a key the type's schema does not declare (or declares retired, or as an overlay `_` key) and a header that differs from the form field label of the same path.
- **Serve.** `getMetaTypes()` serves the registry entry as `list` on the type's `/meta/types` row, next to `form`; `GetMetaTypesResponseSchema` declares it. The REST handler translates each header through the type's form field slot, `metadataForms.<type>.fields.<field>.label`, so a column and the form field of the same key read the same words. `resolveMetadataListLabels` (`@objectstack/spec/system`) does the lookup.
- **i18n.** `os i18n extract` emits that slot for every column whose path the type's form does not already label, with the column's header as the English source. Every `hook` header reuses a form label, so no bundle changes here.
- **Console.** Studio's generic list reads the served columns first: the served list, else the console's own `listColumns`, else name / label / description. A served header is shown as served, already in the reader's language. A key the stored row leaves out shows the default the type's JSON Schema declares there, the value the runtime uses. The console can still draw a served column's cell its own way (`listCells`) and append values the server stamps on a row that are not schema keys (`listExtraColumns`).

New exports: `@objectstack/spec` adds `MetadataListCellTypeSchema`, `MetadataListColumnSchema`, `MetadataListViewSchema`, `defineList` and their types (`ui`), and `METADATA_LIST_REGISTRY`, `MetadataListType` and `resolveMetadataListLabels` (`system`). Nothing that was accepted before is refused, and a client that ignores `list` sees the `/meta/types` it saw before.
