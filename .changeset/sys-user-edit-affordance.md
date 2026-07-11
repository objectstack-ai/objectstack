---
"@objectstack/platform-objects": minor
---

feat(identity): open the standard Edit affordance on sys_user for profile fields (ADR-0092 D4)

`sys_user` now sets `userActions: { edit: true }`, so the generic row-edit
form is available (create / import / delete stay off). The two profile fields
(`name`, `image`) are editable; every other column — `email`, `role`, ban
state, phone, and all system-managed stamps — is marked `readonly` so the
standard edit form renders it non-editable.

This is safe because the server boundary is the identity write guard shipped
in the previous change (ADR-0092 D2): a user-context update to `sys_user` may
only touch `{name, image}` regardless of what any form submits; everything
else is stripped or rejected. The `readonly` flags here are UX only.

The dedicated action dialogs are unaffected — `create_user` / `invite_user` /
`set_user_role` reference `email` and `role` as action **params** (their own
inputs), which do not inherit the field-level `readonly` and stay editable
(verified in the running Console).

Note: the Console's record-form renderer must honor `userActions.edit` +
per-field `readonly` on `managedBy:'better-auth'` objects for the edit form to
be functional; that is an objectui-side change vendored via `objectui:refresh`
and tracked separately.
