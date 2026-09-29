---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the ja-JP, es-ES and zh-CN object help, descriptions and labels that contradicted their current English source are re-translated (#20539)

Clause-②: no

A translated object leaf that a translator wrote by hand is kept as written
when its English source changes later, so some leaves went on saying what the
old source said. On a ja-JP, es-ES or zh-CN console the `sys_two_factor` record
page described `backup_codes` as JSON-serialized, where the English help says
the codes are one opaque ciphertext and not readable JSON.

Nineteen leaves whose meaning contradicted the current English now match it:

- all three locales: `sys_two_factor.backup_codes` help (an opaque ciphertext,
  not JSON), the `sys_notification` description (one notification event per
  `emit()`, not a per-user inbox entry), the `sys_job_run` description (job run
  history, not an audit trail), and the `sys_metadata.environment_id` label
  (Environment, not Project);
- es-ES only: seven `sys_business_unit` / `sys_business_unit_member` labels and
  help texts that still named the business unit a department.

Leaves whose English source only gained detail or was reworded, without
retracting what the translation says, are unchanged. Values only: no key is
added or removed, and no provenance table changes.
