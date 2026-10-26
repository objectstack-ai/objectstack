---
'@object-ui/components': patch
---

fix(components): a refused submit moves focus to the first invalid field and no longer toasts the field list over the dialog's title

Clause-②: no
Metadata-protocol: none

- **Before.** A submit refused by field validation, on the client or by the server's `fields[]`, raised an error toast naming the fields ("Please check the highlighted fields: First name, Last name, Company…") on top of the message already written under each input. The toast cut its list after three names, and in a record create / edit dialog it was drawn over the title row.
- **Now.** The form raises no toast for a refusal that every field carries inline. It scrolls to the first invalid field in form order and focuses it, and first activates that field's tab when it is on a background tab. The message under each input is the whole report.
- **A field with nothing drawn to carry it.** When the server rejects a field that has no drawn input, for example one on a tab or section a `visibleWhen` predicate hides, the form shows the form-level banner and its toast with the server's sentence, the same path a rejection naming an unknown field already takes. The hidden tab is not activated.
- **Earlier outcomes retire.** A refusal on the client now takes down the previous attempt's banner and toast, and a clear-on-hide notice, as an attempt that passes validation already did. Before, the refusal toast replaced them under the form's outcome id.
