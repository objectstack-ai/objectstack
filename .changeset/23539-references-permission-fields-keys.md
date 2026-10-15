---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): an object's "Used by" answer lists a permission set that names the object only in its `fields` keys (#23539)

**What was wrong.** `findReferencesToMeta` serves `GET /api/v1/meta/object/:name/references`, the admin "Used by" panel, which reads an empty answer as "Safe to delete." `PermissionSetSchema.fields` is keyed `<object>.<field>`, and the security plugin applies a set's field rules to an object by that key prefix. The reference index read `permission.fields` only as a site naming `field` items, never an object. So a set whose only rule for an object was a field rule (`objects: {}`, `fields: { 'customer.full_name': … }`) was missing from that object's answer, and the object could be cleared for deletion while the set still masked its fields.

**What the answer reads now.** Such a set is listed for the object that each `fields` key starts with, at path `fields{key}` with kind `permission fields`. The object part is the text before the key's first `.`, the same split the security plugin makes. A key whose field part spells another object's name is not a reference to that object. A key with no object part (`.full_name`) names no object.

Unchanged: every existing row of the answer, the response shape, the `field` target's `501 NOT_IMPLEMENTED` refusal, and `duplicatePackage`.
