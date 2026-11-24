---
'@object-ui/components': patch
'@object-ui/plugin-form': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(ui): every modal dialog draws one lighter surface, short create and edit dialogs are one narrow column, and a create dialog can stay open for the next record

Clause-②: yes (widening)
Metadata-protocol: none

What a user sees:

- Behind a dialog the page is only slightly dimmed (10% in light mode) and no longer blurred, so it stays readable. The dialog is a white card (the raised grey in dark mode) with a hairline edge and a translucent outer ring, a 12px corner, and anything inside it drawn at the shared 40px control height (`h-10`: inputs, select triggers, default and icon buttons, and any other `h-10` element such as a 40px avatar) one step smaller, 32px from the `sm` breakpoint up; the phone sheet keeps its 44px touch targets. Confirmation dialogs, the required-fields prompt and the record create and edit dialog all share it.
- The create and edit dialog's title is 16px and follows the object's icon, and its padding is 20px.
- A dialog that lays out at most six fields and declares no `columns` (not on the form, not on any section) draws one field per row in the narrow `lg` size (672px); six is the maintainer's choice (ruling of record 7061696632 on objectstack-ai/objectstack#35980). This reverses the at-least-two-columns default such a dialog drew before. Seven fields or more, any declared `columns`, an authored `modalSize` or a maximized dialog lay out as before.
- The console's list 「New」 dialog (and a related list's child create) has a 「Create more」 switch. With it on, a save keeps the dialog open on an empty form with focus on the first field, and the list behind refreshes; with it off, a save closes the dialog and opens the new record as before. The switch is remembered per object in this browser.
- ⌘↵ (Ctrl+Enter on other platforms) saves the create and edit dialog, and the Save button shows the keycaps. A master-detail dialog (a record with line items) takes neither the shortcut nor 「Create more」.

What a developer sees (`Clause-②: yes (widening)`, additions only):

- `ModalFormSchema.createMore?: boolean` offers the switch on a `create` dialog that a host mounts itself (the `object-form` renderer's `formType: 'modal'` keeps it off), and `ModalFormSchema.onSuccess` receives a second argument, `{ createMore: true }`, when the dialog stays open. A host that passes neither sees no change.
- New i18n key `form.createMore` in every locale.
- The console's global `[role="dialog"]` corner rule and the blurred overlay on dialogs are gone; the look lives in `@object-ui/components` (`src/lib/dialog-surface.ts`), reached from the `dialog` and `alert-dialog` primitives through declared Shadcn patches. The card carries the `dialog-surface` class, which the console's shared floating-surface shadow skips; a host stylesheet that adds its own shadow to `[role="dialog"]` should skip it too. Popovers and the bottom drawer keep their rounded corners by their own containers; side drawers are unchanged.

Nothing to migrate.
