---
'@objectstack/platform-objects': patch
---

fix: the `sys_user` page and list views show no 2FA state on a deployment where two-factor authentication is off

Clause-②: no
Metadata-protocol: none

`plugin-auth` resolves `twoFactor` to `false` unless a deployment turns it on, and `/api/v1/auth/config` then serves `features.twoFactor: false`. The platform's own `sys_user` declarations showed a 2FA state anyway, with no way to act on it: a "Two-Factor Enabled: No" highlights chip, a 2FA column in the `all_users` and `me` list views, a "2FA Enabled" view tab that could only ever be empty, and a Security-tab "Two-Factor Authentication" heading above an empty action bar.

- **Record page, Security tab:** the 2FA heading, its caption, the 2FA actions and the divider that closes the block carry one component `visibleWhen`, `has(features.twoFactor) && features.twoFactor == true`. With 2FA off, or before the auth config has loaded, the block is not drawn. With 2FA on, the block also shows the user's 2FA state (`two_factor_enabled`) beside the enable, disable and backup-code actions.
- **Record page, highlights:** `two_factor_enabled` is no longer a highlight chip. A highlight field has no per-field gate, so the state moved into the gated Security block. The details grid still hides the field.
- **List views:** `all_users` and `me` drop the `two_factor_enabled` column, and the `two_factor` ("2FA Enabled") list view is retired. A list column or view has no feature gate, and adding one would be a new authorable key.

The `two_factor_enabled` field itself is unchanged. A deployment with 2FA on that wants the column back can add it to its own list view.
