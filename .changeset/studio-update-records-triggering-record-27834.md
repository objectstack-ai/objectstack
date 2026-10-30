---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

Clause-②: no
Metadata-protocol: none

Studio flow designer, Update Records node: on a record-triggered flow a new node starts on the trigger's object, its Filter offers "Update the triggering record" (writes `id` = the CEL expression `record.id`), and the keys of Filter and Field values are picked from the object's fields by label while the API name is what is stored. Existing nodes keep their stored config; other node types are unchanged.
