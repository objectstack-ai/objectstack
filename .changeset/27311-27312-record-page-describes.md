---
'@objectstack/spec': patch
'@object-ui/plugin-detail': patch
---

docs(spec): the related-list descriptions say which unknown names are refused, and `relatedList: 'primary'` and `enable.trackHistory` describe the current record page

Clause-②: no
Metadata-protocol: none

Description text only: no key, type, default, accepted value or export moves, and every stack that parsed, validated or published before still does.

- **`ObjectSchema.relatedLists` and `fieldGroups[i].relatedList`.** The descriptions promised that a name matching no inbound `lookup` / `master_detail` relationship is refused. They now say exactly where. A name whose child is in the stack but has no such relationship to this object is refused everywhere. A name whose child exists nowhere is refused by `os validate` / `os build` (which leave a `sys_` / `cloud_` / `ai_` name to the runtime) and by a metadata write that names no package. A write into a package stores it, because a child outside that package may be a downstream package's object that points in; the record page places nothing for it.
- **`relatedList: 'primary'`.** A primary list is a full-width table in the record's details column, after the first field section, and inside the Details tab when the page is tabbed. It no longer gets a tab of its own; a supporting list is a card in the related column (the shared Related tab when tabbed).
- **`enable.trackHistory`.** The record's field changes join its one timeline stream, under the Changes filter, instead of a History tab. On a page an author assigns, a `record:history` or `record:activity` block shows the record's field changes from its own activity, and neither reads this flag.
- **`@object-ui/plugin-detail` README.** The wide-layout table's timeline column is the one stream (composer, discussion, activity and, with `enable.trackHistory`, field changes) rather than "Activity and History".

What to do: nothing.
