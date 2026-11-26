---
'@object-ui/plugin-detail': patch
---

fix(record-page): the 动态 tab's Changes chip no longer counts the record's creation as one more edit

Clause-②: no
Metadata-protocol: none

On a record of a history-tracked object that one person created and then edited on the same day, the Changes (变更) chip folded the creation's own audit entry into the run of edits: the fold said "4 updates" for three edits, and its first "edit" was the creation drawn as field changes from empty values. The All view of the same stream was right (the edits plus one Created row).

Now the creation's audit entry never joins a fold of field changes, under All and Changes alike: the Changes chip folds the edits alone and shows the creation once, as its own row. No props, locale keys or entry exports change; `isRecordCreationEntry` is added to the `recordTimelineStream` module (not re-exported from the package entry).
