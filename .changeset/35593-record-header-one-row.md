---
'@object-ui/app-shell': patch
'@object-ui/components': patch
---

feat(record-page): the record's header is one row with one button group

Clause-②: no
Metadata-protocol: none

A record page used to stack its top bar, the record's header row under it and, while an approval was pending, a band of decision buttons above the body. They are now one 44px row:

- **Full page.** The object icon and name, `/`, the record's name, its stage tag and an approval tag on the left; the record counter and prev/next, a divider and the record's ONE button group on the right.
- **Drawer.** The record's icon, name, stage tag and approval tag, then the button group, 整页打开 and 关闭. The drawer's bar draws no object name, counter or prev/next once the record's header holds it.
- **One button group, by the approval's state.** Normal: Edit, the record's one primary action and ⋯. Pending on the viewer: 通过 (the only filled button), 驳回, and ⋮ with the other approval levers, a separator and the record's actions. The viewer's own submission pending: 撤回, 催办 and the same ⋮. An administrator who holds only the override keeps the marked override menu ahead of the group. On a phone the bottom bar draws the same group, with 通过 the only filled button.
- **Approval tag.** 「待你审批」, 「审批中」, 「已退回修改」 or 「已驳回」 beside the record's name; it opens the approval's detail, today the approvals panel on the page.
- **Locks.** A record an approval locks draws no Edit; the approval tag says why. A lock from the record's state keeps Edit drawn and disabled, with its lock tag beside the record's name.
- **Reject asks for a reason.** The record page's reject dialog requires its comment. The declaration and the approvals list are unchanged.

A record page whose layout has no `page:header` keeps the decision band above its body, since no header draws the group there. The request page's `ApprovalDecisionPanel` band is unchanged.

`@object-ui/components` adds `RecordHeaderBarContext` (the slots a host's bar offers the record's header) and `RecordHeaderStateContext` (the tags and the button group a host's record state hands it); `RecordTopBar` and `NavigationOverlay` take an `actionSlotRef`, and `NavigationOverlay` a `stepperHidden`. `PageHeaderActions` takes a `defaultMaxVisible`. Nothing an app authors changes.
