---
'@objectstack/spec': minor
'@objectstack/skills': patch
---

feat(spec)!: a form view no longer declares `drawerSide` / `drawerWidth`; no form view opens in a drawer, so neither key was ever read there

Clause-②: no (narrowing)

Metadata-protocol: narrowed

Skills-docs: regenerated here — `skills/objectstack-ui/references/react-blocks.md` (`gen:react-blocks`) lists `<ObjectForm>`'s `drawerSide` / `drawerWidth` as binding props from the block's overlay instead of data props from the form view schema, with the same types; `drawerWidth`'s description drops the form view's `[DEPRECATED → size buckets]` tag (the block's drawer has no size bucket) and says the value is the drawer's width, or its height from the top or bottom edge; no hand-written file under `skills/**` teaches either key on a form view (a `git grep` of `skills/` names only that contract and `rules/record-page.md`'s list-drawer width on `navigation`, which this does not touch).

<!-- adr-0087: registered form-view-drawer-keys-removed, ui-form-view-drawer-keys-retired -->

**BREAKING** accept-set narrowing on the form view surface (`@objectstack/spec`), ADR-0049 enforce-or-remove.

`type: 'drawer'` left the form view earlier in this release, so no form view opens in a drawer. No form-view surface read the two keys either: the console's form page, its New and Edit dialogs, the record form page and Studio all ignored them, so a form view saved with `drawerSide: 'left', drawerWidth: '480px'` was accepted, served and drawn exactly as one without them.

- **FROM → TO.** `form: { …, drawerSide, drawerWidth }` (and `formViews.<key>`, a form view item's `config`) → `form: { … }`. Nothing on the form view replaces them. A list opens a clicked record in its drawer (`navigation.mode`) and sizes it with the `navigation.size` bucket; a React page that opens a form in a drawer writes the props on the block, `ObjectForm` with `formType='drawer'`.
- **The one-line fix.** Delete `drawerSide` and `drawerWidth` from the form view. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored `sys_metadata` row is converted when it is read (the `form-view-drawer-keys-removed` conversion), so a form view saved with the keys keeps loading, and nothing a reader sees changes.
- **What the parse says.** "`view.form.drawerSide` was removed in @objectstack/spec 18.3.0 (ADR-0049) — no form view opens in a drawer, so no form view ever read it. …" (and the same for `drawerWidth`), at every form view door (a view's `form` and `formViews.*`, a form view item record, a flattened form overlay) and at `defineStack` as `STACK_SCHEMA_INVALID` / 422. TypeScript rejects the keys at the authoring site.
- **Unchanged.** The React `ObjectForm` block still takes `drawerSide` / `drawerWidth` for the drawer it opens with `formType='drawer'`: the react-tier contract now declares them on the block itself, with the same types and descriptions. The `object-form` page block keeps both in its own props. `modalSize` stays on the form view; the console's record dialog reads it.
