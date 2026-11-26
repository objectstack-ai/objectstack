---
'@object-ui/app-shell': patch
---

fix(app-shell): the field designer removes a relationship target from a field whose type reads none, so the object still publishes

Clause-②: no
Metadata-protocol: none

The publish gate now refuses a `reference` on a field type that reads none, anything but `lookup`, `master_detail`, `user`, `tree` and `summary` (`field/reference-on-non-reference-type`). The object designer's field panel kept the key when a field was retyped: a `lookup` retyped to `text` saved as text with the old target still on it, and the Related Object picker, drawn only on `lookup`, `master_detail` and `tree`, offered no way to see or clear it there. A retype to a type that reads none now removes `reference`, as it already removes the picklist binding, option kinds, `referenceNameVisible` and `deleteBehavior` the new type cannot carry. An object saved that way earlier is repaired by its next edit: the designer reads such a field without the key, so the next save writes it without one and the publish goes through. Nothing is lost: on those types the key linked no record.
