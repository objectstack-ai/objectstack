---
'@objectstack/service-messaging': patch
'@objectstack/plugin-approvals': patch
---

feat(service-messaging): a keyed notification param can be a list, each item rendered in the recipient's language; the approval "no one can approve" notice names a slate of any size in the reader's language

Clause-②: yes (widening)
Metadata-protocol: none

- `EmitInput.keyedText.params` accepts a new value shape, `{ list, separator }`. Each `list` item is `{ key, params?, fallback }`: a catalog sentence with its own `{{hole}}` params, rendered per recipient. An item param can be text, `{ key, fallback }` or `{ object, fallback }`, but not another list. A sentence with no entry falls back to the item's `fallback`. The rendered items are joined by the `separator` entry (`{ key, fallback }`), so a list of any length reads in one language. A list holds 1 to `NOTIFICATION_LIST_PARAM_MAX_ITEMS` (100) items, and `emit()` refuses a malformed one before it writes anything. The new exports are the types `NotificationListParam`, `NotificationListItem` and `NotificationScalarParam`, and the constant `NOTIFICATION_LIST_PARAM_MAX_ITEMS`. Every existing param shape renders as before.
- The widening reaches the read side too. `NotificationTextParam` is now `NotificationScalarParam | NotificationListParam`, so the exported channel contract `Notification.keyedText` can carry a list param. A channel that reads `keyedText.params` must handle the list shape.
- An older reader does not understand a list row. After a rollback to a version before this one, it reads the row's keys as malformed and delivers or shows the whole notice as its stored English literal, title and body alike. Nothing fails. Within one install this cannot otherwise happen, because the two packages always release together.
- The approval submitter's notice for a request no one else can approve now names a slate of two or more slots through this list param, one `approvalNoApproverSlot` clause per slot, joined by `approvalNoApproverSlotSeparator`. Before, a slate of more than 8 slots named its slots in English inside a zh-CN, ja-JP or other non-English sentence. Now every slot reads in the recipient's language. The literal English body is unchanged. A slate of more slots than a list param holds (more than 100) is sent with the slots as one English clause list instead, as before, so `emit()` does not refuse the notice and the submitter is still told.
- The `approvalNoApproverHoldingSlots2` to `…Slots8` sentences stay in the packs, because notices already delivered carry those keys and are rendered again whenever the inbox is read.
