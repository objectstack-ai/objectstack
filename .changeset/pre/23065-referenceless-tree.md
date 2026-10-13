---
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

fix(spec, objectql): a `tree` field with no `reference` points at its own object, so its `deleteBehavior` takes effect when a parent is deleted

Clause-②: yes (widening)

A `tree` field is a record's parent in a hierarchy on its own object. `reference` is optional on it, and when you write one it must be the object's own name — the object schema refuses any other target and tells you to drop the key. But a `tree` with no `reference` behaved as if it pointed at nothing. Deleting a parent answered success and left every child holding the deleted id, whatever `deleteBehavior` said (`set_null`, `restrict` or `cascade`). The same field also could not be expanded (`expand=parent` answered "declares no target object"), could not be filtered through (`{ parent: { title: … } }` was refused), and accepted a parent id that does not exist.

Now a `tree` with no `reference` is a reference to the object that declares it, exactly as if you had written the object's name:

- **`@objectstack/spec`.** `ObjectSchema` and `ObjectExtensionSchema` write the object's own name (an extension's `extend`) into such a field's `reference` when they parse it. `defineStack` and `ObjectSchema.create()` output, and built artifacts, now carry the object's name in `reference` on those fields, byte-identical to a field that wrote it. Nothing you could write before is refused now. A new export, `materializeTreeSelfReferences(objectName, fields)`, is the one helper both the parse and the engine use.
- **`@objectstack/objectql`.** The object registry writes the same self-reference when an object is registered. That covers an object saved through the metadata API (`PUT /meta/object/:name` stores the body as written) and a direct `registerObject` call, neither of which goes through the parse.

What changes on a parent delete:

- `set_null` (the default) clears the children's parent field and keeps the children.
- `restrict` refuses the delete with `DELETE_RESTRICTED` (409), naming the tree's own object as the dependent.
- `cascade` deletes the whole subtree.

`expand`, nested relation filters, the write-time check that a parent id exists, the dangling-reference audit and `os verify --delete-behaviors` now treat the field as a self-reference too. A `tree` that already wrote its own name, and every `lookup` and `master_detail`, behave exactly as before.
