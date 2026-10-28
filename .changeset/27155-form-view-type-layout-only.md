---
'@objectstack/spec': minor
'@object-ui/app-shell': minor
---

feat(spec)!: a form view's `type` is its layout only — `simple` (the default), `tabbed` or `wizard`; `split`, `drawer` and `modal` are retired, and the split-only `sections[].pane`, `splitSize` and `splitResizable` keys go with them

Clause-②: no (narrowing)

Metadata-protocol: narrowed (`FormViewSchema.type` refuses `split`, `drawer` and `modal`; `FormSectionSchema.pane`, `FormViewSchema.splitSize` and `FormViewSchema.splitResizable` are tombstones)

<!-- adr-0087: registered form-view-presentation-types-removed, ui-form-view-type-layout-only -->

**BREAKING** accept-set narrowing on the form view surface (`@objectstack/spec`), ADR-0050.

The model: `type` says how the form lays out its sections. Where a form opens is decided by whoever opens it, so `drawer` and `modal` were never the form's to declare, and a side-by-side split is a reader's preference since `navigation.mode` dropped `split`.

- **FROM → TO.** `type: 'split'` → `type: 'tabbed'` (one tab per section) or delete the value for `simple`; delete each section's `pane` and the form's `splitSize` / `splitResizable`; declare `subforms` to edit child records beside the parent. `type: 'drawer'` or `type: 'modal'` → delete the value for `simple`, or write the layout you want. A list opens a clicked record as its `navigation.mode` says (the drawer by default), and the console's New and Edit entries open the record form themselves, sized by the form's `modalSize`.
- **The one-line fix.** Delete the retired value and the three split-only keys. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored `sys_metadata` row is converted when it is read (the `form-view-presentation-types-removed` conversion), so a form view saved with one of the three values keeps loading as a `simple` form.
- **What the parse says.** Each retired value is refused by name with its prescription, for example "'modal' was removed from the form view `type` enum in @objectstack/spec 18.3.0 (ADR-0050) — …", at every form view door (a view's `form` and `formViews.*`, a form view item record, a flattened form overlay) and at `defineStack` as `STACK_SCHEMA_INVALID` / 422. `pane`, `splitSize` and `splitResizable` are refused on every layout. TypeScript rejects each at the authoring site. A misspelt value keeps zod's own message.
- **Unchanged.** `drawerSide`, `drawerWidth` and `modalSize` stay declared: the console reads `modalSize` for its record dialog, and the `object-form` block's drawer container reads the other two. `splitDirection` left later in the same release, with the split renderer (#27159).

The console (`@object-ui/app-shell`): Studio's New View form offers the three form layouts only. It offered all six, and a form view created with `split`, `drawer` or `modal` would now be refused when saved.
