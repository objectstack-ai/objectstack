---
'@objectstack/plugin-approvals': patch
---

fix: a new out-of-office delegation opens with the Delegator already set to the signed-in user, and the field's help says why no one else can be chosen

Clause-②: no
Metadata-protocol: none

The Delegator of `sys_approval_delegation` (Setup → Delegations) only ever offers the signed-in user, because the delegation write guard admits nobody else. The field still opened empty, and a search for a colleague answered "No options found" with no reason.

- `delegator_id` now declares `defaultValue: 'current_user'`, the spec's runtime token for a `sys_user` lookup, so the one admissible value is filled in from the start. The write guard is unchanged and stays the enforcement.
- The field's help now reads: "The user going out of office. You can delegate only your own approvals, so this is always you: it starts as you and offers no one else." The `es-ES`, `ja-JP` and `zh-CN` bundles carry the translated text.
