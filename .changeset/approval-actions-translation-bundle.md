---
"@objectstack/plugin-approvals": patch
---

fix(plugin-approvals): localize the declared decision-action labels (objectui#2762 P0-3)

The Approval Center's decision drawer rendered the `sys_approval_request`
declared actions with their literal metadata labels — English **Approve /
Reject / Reassign / Send back / Request info** in a zh-CN workspace, sitting
next to the same page's localized 通过 / 拒绝 inbox buttons. The plugin's
translation bundle covered fields and views but had no `_actions` node, so
the console's `_actions.<name>.label` resolution had nothing to hit.

- Re-ran `os i18n extract` against the plugin's config: the bundles now carry
  `_actions` translations (label, confirmText, successMessage, param labels
  and helpText) for all eight decision actions — `approval_approve`,
  `approval_reject`, `approval_reassign`, `approval_send_back`,
  `approval_request_info`, `approval_remind`, `approval_recall`,
  `approval_resubmit` — in zh-CN, ja-JP and es-ES (en keeps the metadata
  literals).
- The extract also surfaced other untranslated gaps, now filled in all three
  locales: the `returned` status option, the `sys_approval_action.action`
  audit options (`reassign` / `remind` / `request_info` / `comment` /
  `revise` / `resubmit` / `ooo_substitute`), the `attachments` field, and the
  `my_pending` / `recent` view empty states.
