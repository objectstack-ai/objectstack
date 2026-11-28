---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): global search titles a hit by the name `referenceNameVisible` serves when the searcher is refused the record the title points at

Clause-②: no
Metadata-protocol: none

`searchAll` (the ⌘K palette and global search) titles a hit whose object's `nameField` is a reference field by the target record's title, read as the searcher; a searcher refused the target kept the bare id even when the field declares `referenceNameVisible: true`, while the record's `$expand` already served that reader the target's name. The search title now follows the declaration.

- Only for a pointer declaring `referenceNameVisible: true`, and only for the ids the searcher's own title read left untitled, after the same gates (the target's declared exposure serves `get`, its package is not disabled).
- The name is the engine's own `$expand` answer for a refused reader (`{ id, name, readRefused: true }`), read as the searcher: no system-context read is added in the protocol. A name column field-level security keeps from the searcher, or one that declares a `maskingRule`, titles the hit with the `Record #<id>` floor, never the name.
- The name is display only: it never joins the match set, and the hit's `record` still carries the stored id.
