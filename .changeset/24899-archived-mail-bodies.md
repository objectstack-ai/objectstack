---
'@objectstack/cli': minor
'@objectstack/plugin-audit': minor
---

feat(cli,plugin-audit): `os migrate audit-mail-bodies` also masks the mail bodies in the audit copies already moved to the `archive` datasource

Clause-②: yes (widening)

**Re-run `os migrate audit-mail-bodies --apply` on a deployment with an archive datasource.** The 18.0.0 command masked the hot audit tables only.

- **What was left in clear.** `sys_audit_log` declares `lifecycle.archive: { after: '90d', to: 'archive', keep: '7y' }`. Past the hot window, the lifecycle Archiver copies its rows to the datasource named `archive` as they are, then deletes them hot. A `sys_email` / `sys_identity_email` copy archived before the audit writer masked the mail body still holds `body_text` / `body_html` in clear there, password-reset, verification, magic-link and invitation links included, for as long as the archive keeps it. The engine never routes `sys_audit_log` to the archive, so the hot run could not reach those rows.
- **What changed.** After the hot run, the command reads the archive target each copy table declares (`sys_audit_log` only; `sys_activity` declares none) and runs the same mask, in the same dry-run or `--apply` mode, through that datasource's driver. Each archived row keeps every other column, `updated_at` included. The run is idempotent and its report is counts only. A hot copy masked first is archived masked, so one run covers both the copies already archived and the ones still to be.
- **Which archives it reaches.** The command now connects the managed datasources the stack config declares, through the same connect service `os serve` uses. An archive datasource is declared with `autoConnect: true`, since nothing routes objects to it. It is NOT examined, and the run reports `not-connected` and exits `1` rather than reporting a clean archive, in two cases. In the first, the archive is declared but this boot did not connect it; the entry carries the connect status and reason. In the second, the archive is a runtime datasource created in Setup → Datasources, which `os serve` connects and this command does not; declare it in the config's `datasources` and re-run.
- **What `none` means.** No datasource of that name is declared and connected on this boot, none was attempted, and no active runtime datasource row names one. That is all it checks. An archive a host registers in code outside the stack config is not reached and reads `none`. To mask it, declare it in the stack config's `datasources` with `autoConnect: true`.
- **The command's boot can now fail on a declared datasource.** A bound, mapped or boot-critical declared datasource that cannot connect now fails the command's boot with exit `1`, as it fails `os serve`'s. `OS_ALLOW_DRIVER_CONNECT_FAILURE` is the same escape.
- **Run it with the server stopped**, or re-run it once and read 0 to mask in both halves. A live server's Archiver can move a row between the hot run and the archive run.
- **New in the `--json` document:** an `archive` array, one entry per declared target: `{ datasource, objects, status, report?, connection? }`, with `status` one of `examined`, `none`, `not-connected` or `unknown`. The `report` key and its shape are unchanged.
- **New exports from `@objectstack/plugin-audit`:** `migrateArchivedMailLogBodyCopies(driver, logger, options)`, the runner over a datasource's driver, and an `objects` option on both runners, which limits a run to the named copy tables. Types `MailLogBodyArchiveDriver`, `MailLogBodyCopyObject` and `MailLogBodyMigrationOptions`.
