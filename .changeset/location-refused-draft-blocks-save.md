---
'@object-ui/fields': patch
'@object-ui/components': patch
---

fix(fields): a refused location draft now blocks the record form's save

Clause-②: no
Metadata-protocol: none

Text in a `location` box that is not a coordinate pair (`Shenzhen 深圳`) was refused by the widget but never reached the form, so the form value stayed what it was and Update saved it with a success message. When the person had emptied the box first, the stored location was overwritten with `null`. `LocationField` now reports the refusal through `onInvalidInputChange`, and the form renderer turns it into the field's validation error, which blocks submit and is drawn by `<FormMessage/>` in the reader's language. Clearing the box on purpose still writes `null`, and a valid pair still saves. Hosts that do not pass `onInvalidInputChange` (inline edit) keep the widget's own refusal line, as before.
