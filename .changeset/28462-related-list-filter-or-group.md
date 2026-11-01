---
'@object-ui/types': patch
'@object-ui/plugin-detail': patch
'@object-ui/react': patch
---

feat(types): a related list's `filter` and its add-picker `filter` take a view filter's any-of group `{ or: [...] }`, as the spec carriers do

Clause-②: yes (widening)
Metadata-protocol: none

`RecordRelatedListComponentProps.filter` and `.add.picker.filter` in `@object-ui/types` are now `ViewFilterElement[]` (a flat rule or an any-of group `{ or: [rule, ...] }`, from `@objectstack/spec/ui`), the element the protocol's `RecordRelatedListProps` already declares for both keys. The props the related-list renderer hands those values to move with them: `RelatedListProps.filter` and `RelatedListProps.add.picker.filter` in `@object-ui/plugin-detail`, and `ResolveRelatedRecordActionsInput.filter` in `@object-ui/react`. Every value these types accepted before is still accepted; a nested group or a group of tuples is still refused by `tsc`, as the protocol's parse refuses it.

Types only: no runtime code changes. The related list and its picker lower the group through `@object-ui/core`'s `toFilterNode`, which the console reader change for the any-of group teaches to read it.
