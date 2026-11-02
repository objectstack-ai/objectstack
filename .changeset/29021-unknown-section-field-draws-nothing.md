---
'@object-ui/plugin-form': patch
---

fix(plugin-form): a form section naming a field the object does not have draws no control

Clause-②: no
Metadata-protocol: none

A form view section that names a field the object does not declare (a typo, or a field deleted later) used to draw a live text box labelled with the raw name on the `tabbed`, `wizard`, `drawer` and `modal` layouts. Whatever the user typed there was never saved: the record save writes only declared fields, so the value was dropped behind a successful save. Those layouts now draw nothing for such a name, which is what the `form-field-unknown` lint already says ("never renders on the form") and what the default (`simple`) layout already did.

A `customFields` member or a self-describing inline field (one carrying its own `name`) is still drawn, as before. A form with no object schema at all, such as one mounted without a data source whose `submitHandler` owns the write, keeps its bare input for a named field: there is no object to call the name unknown. A section whose every field is unknown is left empty, and each layout treats it as it already treats an empty section.

Fix the field name in the form view, or add the field to the object, to bring the control back.
