---
'@objectstack/platform-objects': patch
---

fix(platform-objects)!: the platform-admin actions declare their gate, so MCP `list_actions` no longer lists them to a caller who cannot run them, and both action doors refuse that caller themselves

Clause-②: yes (narrowing)
Metadata-protocol: none

**BREAKING.** The 15 first-party actions whose door runs the platform-admin gate (on `sys_user`: `ban_user`, `unban_user`, `unlock_user`, `create_user`, `set_user_password`, `impersonate_user`, `set_user_manager`, `list_platform_admins`; on `sys_member`: `add_member`; on `sys_oauth_application`: `disable_oauth_application`, `enable_oauth_application`; on `sys_sso_provider`: `register_sso_provider`, `register_saml_provider`, `request_domain_verification`, `verify_domain`) now declare `requiredPermissions`: `['manage_users']` for the account and membership doors, `['manage_platform_settings']` for the OAuth application and SSO doors. It is the existing ADR-0066 D4 key, read by one runtime check for MCP `list_actions`, MCP `run_action` and `POST /api/v1/actions/:object/:action`. A platform administrator holds both capabilities on either way of becoming one (the `admin_full_access` grant or `OS_PLATFORM_OWNER_EMAIL`), so nothing changes for them.

What changes, FROM → TO:

- **MCP `list_actions`.** FROM: every caller was listed all of these actions (a plain member saw `ban_user` and `set_user_manager`). TO: a caller without the capability is not listed them.
- **The refusal at `POST /actions/:object/:action` and MCP `run_action`.** FROM: the door forwarded the call and the target answered 403 `PERMISSION_DENIED` "Admin role required". TO: the door answers 403 itself, before forwarding, with the capability sentence (`Action 'ban_user' on 'sys_user' requires capability [manage_users] — caller is missing [manage_users]`). The status is unchanged; nothing reaches the target.
- **A caller whose only admin standing is the legacy better-auth `role === 'admin'` scalar** (no `admin_full_access` grant, not in `OS_PLATFORM_OWNER_EMAIL`). FROM: the action doors forwarded the call and the target admitted it. TO: the action doors refuse it 403, because that caller holds no `manage_users` / `manage_platform_settings`. The target endpoints themselves (`/api/v1/auth/admin/*`) are unchanged and still admit it; give the account the `admin_full_access` permission set, or list its email in `OS_PLATFORM_OWNER_EMAIL`, to keep it on the action doors.

What does not change: the target endpoints judge the platform-admin standing as before, the console shows and hides these buttons from their `visible` standing as before, and an action on another object is unaffected.
