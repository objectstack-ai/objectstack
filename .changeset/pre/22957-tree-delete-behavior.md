---
'@objectstack/objectql': patch
---

fix(objectql): a `tree` field's `deleteBehavior` now takes effect when its parent record is deleted, and the default clears the reference

Clause-②: no

The spec gives a `tree` field (a record's parent in a hierarchy on its own object) a `deleteBehavior`, like a `lookup`. When the field declares none, the parse fills in `set_null`. The engine's referential delete pass only followed `master_detail` and `lookup` fields. So deleting a parent node returned success and left every child pointing at the deleted id. An authored `cascade` or `restrict` on a `tree` did nothing either.

A by-id delete now applies a `tree` field's behaviour the way it applies a `lookup`'s:

- `set_null` (the default): the children stay, and their parent field is cleared.
- `cascade`: the whole subtree is deleted, at any depth, and nothing outside it. A cycle in the data (a row whose parent is its own descendant, or itself) ends: each row is deleted once.
- `restrict`: deleting a node that still has children is refused with `DELETE_RESTRICTED` (409), and the dependent named is the tree's own object. A leaf node still deletes.
- On a required `tree` field, `set_null` cannot clear the parent, so deleting a node that has children is refused with `DELETE_RESTRICTED`, as it is for a required `lookup`.

Deleting a record of an object that has a `tree` field now runs as one transaction when the object is on the default datasource, as every delete that can cascade already does. If a node deep in the subtree refuses its delete (a `beforeDelete` hook, say), the nodes already deleted are restored and the call is refused. `lookup` and `master_detail` behave exactly as before.
