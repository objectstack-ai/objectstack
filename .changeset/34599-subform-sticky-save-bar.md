---
'@object-ui/plugin-form': patch
---

fix(plugin-form): the master-detail Save bar stays in view, and closing a master-detail dialog with unsaved input asks first

Clause-②: no
Metadata-protocol: none

A form with inline sub-tables (`subforms`) drew its Cancel and Save buttons after the last field and the last line, so in a dialog, a drawer or on the record page a long form had to be scrolled to the end before it could be saved.

- **The action bar is pinned.** `MasterDetailForm` keeps its own Cancel and Save (ADR-0035 Decision §6), and the bar now sticks to the bottom edge of whatever scroll frame hosts the form: the dialog body, the drawer, the record page. The test ids `md-form-cancel` and `md-form-submit` are unchanged.
- **Closing asks before it discards.** The master-detail arm of `ModalForm` closed on Escape, a backdrop click or the X with the typed values and edited lines gone. It now goes through the same "Discard changes?" confirmation, and the same page-unload prompt, as a form without sub-tables. Input counts when it is in the header fields, in the lines (a change the save would write; a blank line does not count) or in the open row editor. `DrawerForm` already routed its close through the guard, and now hears the master-detail form's input too. The explicit Cancel button still closes at once, and a successful save clears the guard.

Nothing changes in how the form saves (one atomic `/api/v1/batch`), and no prop or type is added to the package's exports.
