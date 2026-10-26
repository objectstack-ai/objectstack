---
'@object-ui/types': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(plugin-detail): the record activity timeline folds consecutive updates by one actor into one row with a count

Clause-②: yes
Metadata-protocol: none

- **Before.** Every `sys_activity` update was its own feed row. When a flow, a rollup or a seed updated a record repeatedly, the system's rows buried the people's comments: a demo campaign showed thirteen consecutive "System · Updated Campaign …" rows in its discussion feed.
- **Now.** `RecordActivityTimeline` folds a run of adjacent `updated` entries by the same actor (`actor_id`, `null` for the system, and the same display name), each no more than 10 minutes after the one before it, into one row. The row shows the actor, the time of the latest entry, the entry count and the union of the changed fields, by their field labels where the page has the object schema and by machine name otherwise (`Updated Number Sent, Leads, Responses · 13 updates`). A toggle (`aria-expanded`) expands it to every entry.
- **Rendering only.** No entry is dropped or merged in the data, and the panel heading still counts every entry. Create, delete, assign, share, comment, completed and milestone rows never fold, and any of them between two updates ends the run. An entry without a summary still folds and still counts. Field names come from `sys_activity.changed_fields`, never from the recorded values.
- **`FeedItem` (`@object-ui/types`).** Four new optional members, set by `activityRowToFeedItem`: `activityType` (the row's own `sys_activity.type`), `activityKind` (`metadata.kind`, e.g. `'milestone'`), `actorId` and `changedFields`. A host item without them renders as before and never folds.
- **Strings.** `detail.foldedUpdates`, `detail.foldedUpdateCount`, `detail.foldedMoreFields`, `detail.expandFolded` and `detail.collapseFolded`, in all ten packs.
