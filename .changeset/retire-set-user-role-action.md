---
"@objectstack/platform-objects": patch
"@objectstack/spec": patch
---

**Fix:** `sys_user`'s **`set_user_role`** action ("Set Platform Role") is retired — removed from the object's declared actions, not re-implemented (#9968).

The action's only effect was `POST /api/v1/auth/admin/set-role`, which better-auth's `admin` plugin lowers to `internalAdapter.updateUser(userId, { role })` — a gated, UI-driven writer for the legacy `sys_user.role` scalar that ADR-0068 D2 stopped synthesizing. Platform-admin membership is granted through `sys_user_permission_set` / `admin_full_access`; a working "Set Platform Role" button was a supported, one-user-at-a-time channel for resurrecting the dual identity representation the 2026-08-18 ruling permanently vetoed (Option 3).

**What an operator will now observe.** The "Set Platform Role" button is gone from the Users list row menu and the user detail header. It was already dead for every platform admin before this change — better-auth's vendor `adminMiddleware` gates on the same retired scalar, so the button 403'd with `YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE` for platform admins and plain members alike. Removing it removes a byte-identical-refusal dead affordance, not a working capability.

**Unchanged.** The vendor's `POST /api/v1/auth/admin/set-role` route itself stays mounted and vendor-gated exactly as before — this change touches only the `sys_user` console action pointing at it. Every other `sys_user` admin action (`ban_user`, `unban_user`, `unlock_user`, `create_user`, `set_user_password`, `impersonate_user`) is unaffected.

`@objectstack/spec`'s `PUBLIC_AUTH_FEATURES.admin.gatedInputs` registry drops the corresponding `sys_user.actions.set_user_role` entry in the same change (`packages/spec/src/kernel/public-auth-features.ts`) — internal completeness-guard bookkeeping only, no public export shape change.
