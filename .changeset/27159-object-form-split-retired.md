---
'@objectstack/spec': minor
'@objectstack/skills': patch
'@object-ui/plugin-form': minor
'@object-ui/types': minor
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(spec,plugin-form)!: `ObjectForm` lays a form out and no longer picks its container; the `object-form` block drops `formType: 'split'` and `SplitForm` retires, while the block keeps opening `drawer` and `modal` forms itself

Clause-②: no (narrowing)

Metadata-protocol: narrowed (the `object-form` block's `formType` refuses `split`; its `splitDirection`, `splitSize`, `splitResizable` and `sections[].pane`, the `object-master-detail-form` block's `sections[].pane`, and `FormViewSchema.splitDirection`, are tombstones)

<!-- adr-0087: not-required (already-registered form-view-presentation-types-removed, ui-form-view-type-layout-only) 18.3.0 is unreleased, so this change widens those two entries in place: the conversion now strips splitDirection and reaches object-form page blocks, four new RETIRED_KEYS_BY_MAJOR rows record the tombstoned keys, and the D3 entry names the block -->

**BREAKING** accept-set narrowing on the `object-form` page block and the form view (`@objectstack/spec`), and a removed export (`@object-ui/plugin-form`). ADR-0050, the renderer half of #27155.

The model: a form's `formType` says how it lays out its sections. Where it opens is the caller's. On the `object-form` block the caller is the block itself, so `drawer` and `modal` stay there as the two containers the block opens; `split` drew two panes and had no other reader, so it leaves with its renderer.

- **FROM → TO (block).** `formType: 'split'` → `formType: 'tabbed'` (one tab per section) or delete the value for `simple`; delete each section's `pane` and the block's `splitDirection` / `splitSize` / `splitResizable`. To edit child records beside the parent, use an `object-master-detail-form` block. `formType: 'drawer'` and `formType: 'modal'` are unchanged. The `object-master-detail-form` block's parent `sections` share the shape, so delete each section's `pane` there too.
- **FROM → TO (form view).** `splitDirection` on a form view → delete it. It joins `splitSize` and `splitResizable`, which left in the same release.
- **The one-line fix.** Delete the retired value and keys. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored page or view row is converted when it is read (the `form-view-presentation-types-removed` conversion now reaches `object-form` page blocks, the section `pane` of `object-master-detail-form` blocks, and `splitDirection` too), so a block saved with `split` keeps loading as a `simple` form.
- **What the parse says.** `formType: 'split'` is refused by name with its prescription ("'split' was removed from the `object-form` `formType` enum in @objectstack/spec 18.3.0 (ADR-0050) — …"); each tombstoned key is refused on every `formType`. TypeScript rejects each at the authoring site.
- **`@object-ui/plugin-form`.** `ObjectForm` renders the `simple`, `tabbed` and `wizard` layouts only; a `formType` of `drawer` or `modal` on a node handed straight to `<ObjectForm>` now renders the inline form, and the host opens its own drawer or dialog around it (the console's New and Edit dialogs already mount `ModalForm` themselves). The registered `object-form` block routes `drawer` and `modal` through the new internal `ObjectFormContainer`, which hands the node to `DrawerForm` or `ModalForm` as before. `SplitForm`, `SplitFormProps` and `SplitFormSchema` are no longer exported, and the block no longer publishes the `splitDirection`, `splitSize` and `splitResizable` inputs. FROM `import { SplitForm } from '@object-ui/plugin-form'` → TO a `TabbedForm`, or the `form` renderer's `fieldPanes` for a host that composes panes itself.
- **`@object-ui/types`.** `ObjectFormSchema.formType` is `'simple' | 'tabbed' | 'wizard' | 'drawer' | 'modal'`, and its `splitDirection` / `splitSize` / `splitResizable` are the spec's tombstones by reference; the section `pane` member is gone.
- **Console.** Studio's page-block inspector no longer offers `Split` for an `object-form` (its `engine.inspector.pageBlock.option.formType.split` string is removed from `@object-ui/i18n`), the record page passes no split keys, and a view whose `type` is not one of the three form layouts is no longer taken for a form (`@object-ui/console`).
- **Supersedes one line of the form view `type` entry (#27155).** That entry says `splitDirection` stays declared; in this release it leaves too.
- **Unchanged.** `drawerSide`, `drawerWidth`, `modalSize` and `modalCloseButton` keep their readers: the block's drawer and modal containers. The enforce-or-remove question for `drawerSide` / `drawerWidth` on form views stays on #27153.
