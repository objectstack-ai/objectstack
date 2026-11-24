---
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
---

fix(record-page): Esc in the side preview ends an inline edit and keeps the preview open

Clause-②: no
Metadata-protocol: none

In a record's side preview (the drawer beside a list, or a record page's drawer), a field clicked into edit no longer loses the whole preview to Esc:

- **While a field is being edited**, Esc ends the edit and the preview stays open. It does what Esc does on the record's full page: the typed change is discarded without a prompt and nothing is written. The next Esc closes the preview (or, a level down, goes back one level), as before.
- **A popover, select or menu open over the record** still takes Esc first and closes alone; the edit and the preview stay.
- **The full record page is unchanged.**

For hosts of `NavigationOverlay` (`@object-ui/components`): a drawer now holds itself open on Esc while it draws an element marked `data-owns-pane-escape`, which `InlineEditSaveBar` (`@object-ui/plugin-detail`) carries while the record is being edited.
