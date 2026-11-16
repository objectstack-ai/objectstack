---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity row names a record whose `nameField` is a lookup by the target record's title, and a tracked yes/no change reads as words in the reader's language

Clause-②: no
Metadata-protocol: none

**Lookup `nameField` labels.** An object titled by a lookup or `user` field (a project member with `nameField: 'person'`, a lookup to `sys_user`) was named in its activity rows by the stored foreign key: `Created Project Member "gCX6SR…"` in `record_label` and in every created, updated and deleted sentence, while the record page header showed the person's name. The CRUD mirror now follows such a title field to the target record's own title (ADR-0079's title field of the target), through the same resolver that already titles a referenced record inside a field-change summary: the target's declared API exposure must serve `get`, a credential or `internal` title column is never read, and the read is one `id: { $in }` query per write, projected to the id and the title column. An object titled by any other field pays no read for its label. A multi-value lookup names every title it holds. The label still declares the lookup field as its source, so a reader not served that field is still served the row without it.

The title is read as the writer, not as the system. A writer the security layer refuses the target, or serves the target row without its title column, gets the stored value in the label, as before, and never a title the writer could not have read. An id the target has no row for also keeps the stored value. Rows written before this release keep the label they were written with.

**Yes/no changes.** A tracked `boolean` or `toggle` field change read as the literals `false → true`, beside select changes that already read through their option labels (`Status: New → Converted; Converted: false → true`). The value is now stored in the summary code as a boolean and worded by two new message keys in the plugin's bundles, `messages.activityValueTrue` and `messages.activityValueFalse`, in all eleven platform languages. The stored sentence uses the write locale, and a read with a locale re-composes it in the reader's locale, as the verb templates are (`Converted: No → Yes`, zh-CN `已转化: 否 → 是`). A boolean field that declares its own options keeps reading through them. A fired milestone's sentence is the author's and still interpolates a boolean token as stored.
