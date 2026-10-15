---
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

fix(plugin-security,spec): the unnamed-grant boot line and the `ups-permission-set-id-column-retired` upgrade entry name the reviewed-plan ceremony, `--out plan.json` then `--apply --backup-taken --plan-file plan.json`, instead of a bare `--apply` the CLI refuses (ADR-0131 D10)

Clause-②: no

`os migrate organization-ownership --apply` refuses a run without `--plan-file`, the file a plan run wrote and the operator reviewed. Two remedy texts still told the operator to run `--apply` alone, which answers `plan-file-required` and writes nothing:

- `@objectstack/plugin-security`: the `kernel:bootstrapped` catalog reference report's error line for grants that name no permission set (`permission_set` empty).
- `@objectstack/spec`: the `replacement` of the ADR-0087 entry `ups-permission-set-id-column-retired`, the row the upgrade guide prints for the retired `sys_user_permission_set.permission_set_id`.

Both now name the two steps: plan first, `os migrate organization-ownership --out plan.json`, review the file it writes, then `os migrate organization-ownership --apply --backup-taken --plan-file plan.json`, which executes that plan; restart afterwards. The ceremony itself is unchanged: its rewrite names each legacy grant from the retired id, and its column-drops step drops the two retired indexes and then the column. Only the text changes; the line's level, its fields and the entry's `id` are as they were.
