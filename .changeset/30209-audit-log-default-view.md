---
'@objectstack/plugin-audit': patch
'@objectstack/platform-objects': patch
---

fix(plugin-audit,platform-objects): the audit log's default list shows what people did, not the rows the platform writes beside it; the audit objects read in Chinese

Clause-②: no
Metadata-protocol: none

Setup's 审计日志 opens the first `sys_audit_log` list view, `recent`. One sign-in used to put two rows there (the `login` row and an `update` of the person's `sys_user` stamping `last_login_at` / `last_login_ip`), the first sign-in through the console a third (the token-signing key in `sys_jwks`), and one settings change three or four (the `config_change` row, the stored setting, a secret's ciphertext, and the settings trail's own entry).

- The ledger writer now marks the sign-in stamp row with `metadata: {"event":"auth.last_login_stamp"}`, the way `config_change` rows carry `settings.set`. Only an update of `sys_user` whose changes are the stamp's fields alone is marked; an administrator's edit of a user is not. The row is still written.
- `recent` leaves out the marked row, the rows on `sys_secret`, `sys_setting_audit`, `sys_platform_setting_audit`, `sys_jwks`, `sys_migration` and `sys_migration_journal`, and the rows on `sys_setting` / `sys_platform_setting` other than `config_change`. Nothing is removed from storage, and `all_events` (全部) still lists every row.
- `sys_platform_setting` and `sys_platform_setting_audit` were in no translation bundle, so they read English in every locale; they now ship in `@objectstack/platform-objects`' bundles with zh-CN translations (ja-JP and es-ES carry the English fill). `sys_comment_reaction`'s zh-CN bundle is translated.
