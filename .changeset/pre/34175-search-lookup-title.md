---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): global search titles a hit by the referenced record's title when the object's `nameField` is a reference field

Clause-②: no
Metadata-protocol: none

`searchAll` (the ⌘K palette and global search) titled a hit by the stored value of the object's primary-title pointer. When that pointer is a reference field (`lookup`, `master_detail`, `user` or `tree`), the stored value is the target record's id, so the hit was titled by a raw key while the record page header named the target. The title now follows the reference to the target record's own title (its `nameField`).

- The target titles are read in one `id $in` read per searched object, never one per hit, selecting `id` and the title column only.
- The read runs as the searching user: the target's object permission, row scope and field-level security apply. A reader refused the target object, the row or its title column keeps the bare id, as `$expand` answers that reader on a field that does not declare `referenceNameVisible`. A target whose declared API exposure does not serve `get` is not read.
- A target read that fails for any other reason fails the search, as a failing record read in the same sweep already does.
- The hit's shape is unchanged: `record` still carries the stored id, and only `title` changes.
