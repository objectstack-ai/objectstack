---
'@objectstack/spec': minor
'@object-ui/plugin-form': minor
'@object-ui/types': minor
---

feat(spec)!: a form view's `buttons` block holds `submit` and `cancel` only; `buttons.reset` is retired, because no form ever drew a reset button

Clause-②: no (narrowing)

Metadata-protocol: narrowed (`FormViewSchema.buttons.reset` is a tombstone)

<!-- adr-0087: registered form-view-buttons-reset-removed, ui-form-view-buttons-reset-retired -->

**BREAKING** accept-set narrowing on the form view surface (`@objectstack/spec`), ADR-0049 enforce-or-remove.

The console draws a form's Submit and Cancel buttons on every entry point (the form page, the New and Edit dialogs, the record form page, master-detail forms). None of them drew a reset button, and `buttons.reset.label` was never read. The one renderer fold that read `buttons.reset.show` passed it to ObjectForm's clear-after-save flag, so `show: true` emptied the form after a successful save instead of adding a button.

- **FROM → TO.** `buttons: { submit, cancel, reset }` → `buttons: { submit, cancel }`. There is nothing to write instead: Cancel leaves the form without saving.
- **The one-line fix.** Delete `buttons.reset`. `os migrate meta --from 17` lists the edit for existing sources, and `--write` applies it. A stored `sys_metadata` row is converted when it is read (the `form-view-buttons-reset-removed` conversion), so a form view saved with the key keeps loading.
- **What the parse says.** "`view.form.buttons.reset` was removed in @objectstack/spec 18.3.0 (ADR-0049) — no form ever drew a reset button, and its label was never read. …", at every form view door (a view's `form` and `formViews.*`, a form view item record, a flattened form overlay) and at `defineStack` as `STACK_SCHEMA_INVALID` / 422. TypeScript rejects the key at the authoring site.
- **Unchanged.** `buttons.submit` and `buttons.cancel` parse and render as before.

The renderer (`@object-ui/plugin-form`, `@object-ui/types`): `ObjectForm` no longer folds `buttons.reset.show` onto `showReset`, and the `ObjectFormSchema.buttons` mirror (type and zod) drops `reset`. The flat `showReset` prop itself is unchanged.
