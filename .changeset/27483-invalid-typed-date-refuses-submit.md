---
'@object-ui/fields': patch
'@object-ui/components': patch
---

fix(fields, components): a date typed in a form the picker cannot read is a field error that refuses submit, not a silent drop (#27483)

Clause-②: no
Metadata-protocol: none

Typing `13/45/2026` into a record form's date field and pressing Create saved the record with the date empty (or, on edit, with the old date) and a success toast. The picker never writes text that names no date, so the form value stayed what it was and nothing told the form.

- **Now.** The text box is marked invalid as soon as the user leaves it, the field shows the picker's message (the typed text and the expected format) as its form error, and submit is refused the way a missing required value is: the dialog stays open and nothing is sent. Correcting or clearing the text withdraws the error. `datetime` fields behave the same.
- **`onInvalidInputChange`** is a new optional widget prop on `FieldWidgetComponentProps` (`@object-ui/fields`): a widget that parses typed text fires it with a message when the committed text names no value, and with `null` once it is valid, cleared, or unmounted. The `form` renderer (`@object-ui/components`) turns the message into the field's `invalidInput` validation error and passes the callback to the `date` / `datetime` widgets only. A widget given the callback leaves the message text to the form; hosts that pass none (the grid's inline editor, the action-param dialog) keep the picker's own notice, unchanged.
