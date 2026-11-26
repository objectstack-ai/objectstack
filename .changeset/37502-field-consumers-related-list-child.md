---
'@objectstack/lint': patch
---

fix(lint): `field-no-consumers` credits a related list's columns to the child object it lists

Clause-②: no
Metadata-protocol: none

- An object-form `relatedLists` entry (`{ list, label?, columns? }`) is now read against the child object its `list` names (`child`, or `child.field`), not against the object that declares the list. Its `columns` are the child's field names, so each one counts as a display of the child's field.
- Before, a column was credited to the declaring object's field of the same name. A parent field that nothing displayed stayed silent whenever a child's related-list column had the same name (the blank starter's company lists its contacts with a `phone` column, which kept an undisplayed `company.phone` quiet), and the child's own column did not count for the child.
- What you may see: `os validate` and `os lint` can now report a parent field that only a child's related-list column used to cover. Place the field (a field group, `highlightFields`, a view column) or remove it. A child field that only a related list draws is no longer reported. A column of a child this stack does not declare credits no object. The rule stays a warning.
- `child.field` in `list` now also counts as a read of that relationship field on the child: the list joins on it.
