---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

feat: the object read names the objects a delete can cascade into, beside the item

Clause-②: yes (widening)
Metadata-protocol: none

- **Served beside the object** (`@objectstack/metadata-protocol`, `@objectstack/rest`). `GET /api/v1/meta/object/:name` serves `cascadeDeleteObjects` beside `item`: the names of the objects that deleting a record of this object can also delete. That is every object whose relation into it cascades (a `master_detail` by default, a `lookup` or `tree` that declares `deleteBehavior: 'cascade'`), and the objects that cascade into those in turn, each once. A `restrict` or `set_null` relation removes nothing and is not named. The default cached door carries it too, and the list is folded into that door's ETag, so an object registered later that cascades into this one changes the ETag. The key is absent where no engine answered, on a draft read, on the list read and on every type other than `object`; `[]` means nothing cascades. `item` is unchanged. A delete confirmation can now name what else a delete removes without keeping its own copy of the rule.
- **The fact it serves** (`@objectstack/objectql`). `ObjectQL.getCascadeDeleteObjects(object)` answers that list from the delete walk's own relation scan, which the delete and this read now share. It reads the registry and no row, so it never says which records or how many. It returns `undefined` for an object the registry does not hold.
- **The declaration** (`@objectstack/spec`). `GetMetaItemResponseSchema` and `GetMetaItemCachedResponseSchema` gain the optional `cascadeDeleteObjects` (an array of object names), and `IObjectQLEngine` gains the optional member `getCascadeDeleteObjects(objectName)`, which the metadata read calls through the kernel's service table. Nothing about it is authorable.
