---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the boot report's unnamed-grant line says what 18.0 supports for a v17 database, not a command 18.0 refuses

Clause-②: no

- **The error line for `sys_user_permission_set` grants whose `permission_set` is empty** used to end with a fix: plan with `os migrate organization-ownership --out plan.json`, then run `os migrate organization-ownership --apply --backup-taken --plan-file plan.json`, restart, with a warning that granting the set again by name before it runs leaves a second grant for the ceremony to report. 18.0 refuses that command on every database, so the operator was sent to a refusal. The line now ends with the sentence the drop-gate refusal of `os migrate apply --allow-destructive` carries: "18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path."
- **Unchanged:** the count, the "permission_set is empty" fact, the ADR-0131 D4 reason ("each confers nothing"), "Nothing was changed.", the structured meta, the log level and the report's result. Such a grant still confers nothing and is still listed.
- **Removed from the line:** the two command steps and the restart step, and the advice about granting the set again by name. They described the 18.x upgrade ceremony, which 18.0 does not carry.
