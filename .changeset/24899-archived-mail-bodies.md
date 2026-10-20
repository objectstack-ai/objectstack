---
'@objectstack/cli': minor
'@objectstack/plugin-audit': minor
---

feat(cli,plugin-audit): `os migrate audit-mail-bodies` also masks the mail bodies in the audit copies already moved to the `archive` datasource

Clause-②: yes (widening)

**Re-run `os migrate audit-mail-bodies --apply` on a deployment with an archive datasource.** The 18.0.0 command masked the hot audit tables only.

- **What was left in clear.** `sys_audit_log` declares `lifecycle.archive: { after: '90d', to: 'archive', keep: '7y' }`. Past the hot window, the lifecycle Archiver copies its rows to the datasource named `archive` as they are, then deletes them hot. A `sys_email` / `sys_identity_email` copy archived before the audit writer masked the mail body still holds `body_text` / `body_html` in clear there, password-reset, verification, magic-link and invitation links included, for as long as the archive keeps it. The engine never routes `sys_audit_log` to the archive, so the hot run could not reach those rows.
- **What changed.** After the hot run, the command reads the archive target each copy table declares (`sys_audit_log` only; `sys_activity` declares none) and runs the same mask, in the same dry-run or `--apply` mode, through that datasource's driver. Each archived row keeps every other column, `updated_at` included. The run is idempotent and its report is counts only. A hot copy masked first is archived masked, so one run covers both the copies already archived and the ones still to be.
- **Which archives it reaches.** The command now connects the datasources the stack config declares, as `os serve` does. An archive datasource is declared with `autoConnect: true`, since nothing routes objects to it. If the archive is instead a runtime datasource created in Setup → Datasources, which `os serve` connects and this command does not, the run reports it `not-connected` and exits `1` rather than reporting a clean archive. Declare it in the config's `datasources` and re-run.
- **New in the `--json` document:** an `archive` array, one entry per declared target: `{ datasource, objects, status, report? }`, with `status` one of `examined`, `none`, `not-connected` or `unknown`. The `report` key and its shape are unchanged.
- **New exports from `@objectstack/plugin-audit`:** `migrateArchivedMailLogBodyCopies(driver, logger, options)`, the runner over a datasource's driver, and an `objects` option on both runners, which limits a run to the named copy tables. Types `MailLogBodyArchiveDriver`, `MailLogBodyCopyObject` and `MailLogBodyMigrationOptions`.
