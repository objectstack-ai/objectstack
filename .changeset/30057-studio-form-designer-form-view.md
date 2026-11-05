---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the Studio form designer lays out the form the app opens, so an object with a default form view no longer edits a layout users never see

Clause-②: no
Metadata-protocol: none

- **Which layout.** Studio → Data → an object → Form asks the app's own resolver which form view New and Edit open (`selectRecordFormView`, over the shell's merged objects). With none, the designer edits the object's `fieldGroups`, as before. With one (an `isDefault` form view, or an `OBJECT.create` view for New), the designer shows that view's sections and every layout edit (moving fields, adding, renaming, moving and deleting sections) is saved to the view's draft, which the package publish publishes. A chip in the toolbar names the layout being edited ("Form view: OBJECT.form" or "Field groups").
- **New and Edit.** Where New and Edit open different form views, a New / Edit switch in the toolbar picks which one the designer and the Preview show. A pending edit of the shown view is sent before the other one loads.
- **Fields not on the form.** On a form view, a field the view lists in no section is not on the form; the designer keeps such fields in a "Not on this form" bucket, and dragging one into a section adds it. A field entry's own keys (`required`, `readonly`, …), a section's other keys, and entries the canvas does not show are written back as they were. A section that references a field group (`group`) keeps the reference until its members are changed.
- **Read-only base.** On a read-only base the view is customized, not edited: the edit is saved into the base's paired customization package as a declared override of the base's view (ADR-0146 D2), the same door list views use.
- **Preview.** The Form tab's Preview now lays the form out by the same form view (its sections, and the tabbed layout), as the dialog it previews does; before, it drew the object's field groups whatever form view the app opened.
- **`@object-ui/i18n`.** English and Chinese strings for the chip, the New / Edit switch and the "Not on this form" bucket.
