---
'@objectstack/platform-objects': minor
'@objectstack/plugin-approvals': minor
---

Point the account app's **Approvals** navigation entry at the Approvals Inbox component, and contribute an **Approvals Inbox** entry to Setup (#7234).

The entry point has not moved — the account menu still shows **Approvals** with the same
label and icon in every locale. Its destination has. It used to open the raw
`sys_approval_request` grid, which is an admin/diagnostic view of the engine's own table
and cannot show an approver a single decision button: every action on that object is gated
on `record.viewer.can_act || record.viewer.can_override`, and the `viewer` block is
attached only by the approvals REST path, never by the generic data API the object route
reads. The result was a correct-looking list of rows nobody could act on. The entry is now
`{ type: 'component', componentRef: 'approvals:inbox' }`, so it opens the full inbox —
decision actions, business vocabulary, node progress and the request drawer.

- **Account app**: `nav_account_approvals` becomes a component entry gated by
  `requiresService: 'approvals'`, so it disappears where `plugin-approvals` is not
  installed (the previous `requiresObject` gate does not apply to a component entry).
- **Setup**: `plugin-approvals` contributes a new **Approvals Inbox** entry at the top of
  **Setup → Approvals**, above the three raw tables, which stay exactly as they were —
  admin-gated by `manage_platform_settings` and now unambiguously the diagnostic surface.
  Labels ship in all four locales (zh-CN 审批中心).
- `sys_approval_request` is no longer surfaced raw to end users anywhere.
- **Docs**: the approver's queue is documented as the Approvals Inbox, with a snippet for
  mounting it in any business app — one navigation entry naming the component-registry key
  `approvals:inbox`, never a console path.

Reaching the inbox end to end in the browser additionally requires the console pin bump,
tracked separately.
