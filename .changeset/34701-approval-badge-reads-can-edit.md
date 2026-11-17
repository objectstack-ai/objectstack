---
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

fix(plugin-detail): the approval badge says "In approval · editable" only when the record is editable for the viewer

Clause-②: no — a label that claimed an edit the record refuses now says only that an approval is running; no surface added
Metadata-protocol: none

On an approval node that declares `lockRecord: false`, the record page's approval badge read 「审批中 · 可编辑」 / "In approval · editable" from the node alone. When another gate closed the record for this user (record permission, the edit action's `disabledWhen` / `visibleWhen`, a `readonlyWhen` lock on every field), the badge still said editable and every edit was refused. The badge now also reads the host's `canEdit`: when it is false the badge reads 「审批中」 / "In approval" (new `detail.approvalPending` and `detail.approvalPendingNotEditableTooltip` keys in every locale). A lock an app enforces only in an imperative hook stays invisible to the client; declare it with `userActions.edit.disabledWhen` or `readonlyWhen` so the record page can show it.
