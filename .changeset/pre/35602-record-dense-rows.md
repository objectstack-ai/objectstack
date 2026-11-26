---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(record-page): dense field rows, one-line activity entries grouped by day, and one row per attachment

Clause-②: no
Metadata-protocol: none

The record page now fits more on one screen: fields read as one row each with the label on the left, the activity feed shows one line per entry under a day heading with a one-line comment box, and each attachment is one file row with its actions in a ⋮ menu.

New locale keys in every pack: `detail.streamToday`, `detail.streamYesterday`, `detail.viewApproval`, `detail.replyToComment`, `detail.attachmentsDropHint`, `detail.attachmentsChooseFile`, `detail.attachmentActions`. `RecordActivityTimeline` takes an optional `onViewApprovals`; `RichTextCommentInput` takes an optional `compact`; `CommentBody` takes an optional `controlsClassName`. No metadata key, value or default changes.
