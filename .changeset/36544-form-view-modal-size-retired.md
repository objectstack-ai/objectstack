---
'@objectstack/spec': minor
'@objectstack/skills': patch
---

feat(spec)!: a form view no longer declares `modalSize`; no form view opens in a dialog, so nothing read the key there

Clause-②: yes (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: registered form-view-modal-size-removed, ui-form-view-modal-size-retired -->

**BREAKING** accept-set narrowing on the form view surface (`@objectstack/spec`), ADR-0049 enforce-or-remove.

The one reader of a form view's `modalSize` was the console's New / Edit record dialog, which copied it from the object's internal form view. Since 18 that dialog loads no form view: it lays a record out by the object's `fieldGroups` and chooses its own size. A form opened by name, or by a public link, gets a page of its own. So a form view saved with `modalSize: 'lg'` was accepted, served and drawn exactly as one without it.

- **FROM → TO.** `form: { …, modalSize }` (and `formViews.<key>`, a form view item's `config`, a `form` item) → `form: { … }`. Nothing on the form replaces it. The record dialog picks its size from the number of fields it draws, and the person filling it in can maximize it; a React page that opens a form in a modal writes the prop on the block, `ObjectForm` with `formType='modal'`.
- **The one-line fix.** Delete `modalSize` from the form view. `os migrate meta --from 18` lists the edits for existing sources, and `--write` applies them. A stored `sys_metadata` row is converted when it is read (the `form-view-modal-size-removed` conversion), so a form view saved with the key keeps loading, and nothing a reader sees changes.
- **What the parse says.** "`view.form.modalSize` was removed in @objectstack/spec 19.0.0 (ADR-0049) — no form view opens in a dialog, so nothing reads it from a form view. …", at every form view door (a view's `form` and `formViews.*`, a form view item record, a flattened form overlay, a `form` item) and at `defineStack` as `STACK_SCHEMA_INVALID` / 422. TypeScript rejects the key at the authoring site.
- **Unchanged.** The React `ObjectForm` block still takes `modalSize` for the modal it opens with `formType='modal'`: the react-tier contract now declares it on the block itself, with the same type. The `object-form` page block keeps it in its own props. A form view's `subforms` is not touched by this change.

The retirement kit: the `retiredKey()` tombstone on `FormViewSchema` (the `form` item takes it by reference); the D2 conversion `form-view-modal-size-removed` (protocol 19, retired from the load path, reaching `form`, `formViews.*`, form view items, flattened form overlays and `forms[]`); `RETIRED_KEYS_BY_MAJOR[19]` rows `ui/FormView:modalSize` and `ui/Form:modalSize`; the D3 entry `ui-form-view-modal-size-retired`; the liveness rows `view.json` `form.modalSize` and `form.json` `modalSize`, now `dead`.

Also corrected: the protocol-18 D3 entry `ui-form-view-type-layout-only` said the console's New and Edit dialogs were "sized by `modalSize`". They choose their own size, and the entry now says so.

`@objectstack/skills`: `skills/objectstack-ui/references/react-blocks.md` is regenerated. `<ObjectForm>`'s `modalSize` is listed as a binding prop from the block's overlay, no longer as a data prop from the form view schema.
