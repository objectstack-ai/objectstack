---
'@object-ui/i18n': patch
---

feat(i18n): the `listConditions` namespace carries the words of the field manager

Clause-②: no
Metadata-protocol: none

Every pack gains six `listConditions.fieldList.*` keys for managing a view's fields in the shared field list: the fields not in the view yet, add, show, hide and move a field, and the reorder hint. Nothing reads them yet; the list's Options → Fields panel starts using them in a later release. No existing key changes.
