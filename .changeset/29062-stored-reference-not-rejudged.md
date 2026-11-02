---
'@objectstack/objectql': patch
---

fix(objectql): an update that carries a stored reference back unchanged is no longer refused because that reference has since stopped resolving (#29062)

Clause-②: yes (widening)
Metadata-protocol: none

The write-time reference check (`reference_not_found`) now judges only the reference values a write adds. Deleting a user leaves its id in every `user` field and multi-valued `user` field that named it, because the delete walk does not reach the `user` type. The next edit of such a record, for example an edit form saving the whole record back, was refused `reference_not_found` for a value the editor never touched. Now a value, or a member of a multi-valued field, that the row already stores is not judged again. On an update by id the stored row decides. On a predicate (`multi: true`) update a value is forgiven only when every matched row already stores it. A missing id the write adds is refused exactly as before, and an insert judges every value it supplies.

The rule covers every reference type the check reads (`lookup`, `master_detail`, `user` and their multi-valued forms), a single `user` field included. Nothing is narrowed: every write accepted before is still accepted.
