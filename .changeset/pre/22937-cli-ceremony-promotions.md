---
'@objectstack/cli': minor
---

feat(cli): `os migrate organization-ownership --apply` promotes customized email templates and moves the settings global rung (ADR-0131 D10)

Clause-②: yes (widening)

Two steps join the ceremony, after the authored catalog conversion and before the verified id→name rewrite. Each is checkpointed and resumable like the others.

- **`template-promotion`** (ruling C on ADR-0131 §6 Q1). Every `sys_email_template` row the mirror deletion keeps for it (customized, or with `customized` unknown, and every row no seeder wrote: `managed_by` NULL or other than package / platform / system, with or without an organization) becomes an environment `email_template` item through the metadata door, one per `(name, locale)`, before mirror deletion removes the rows. It runs under every posture. Seeded, uncustomized copies are not promoted. A promotion that already landed is skipped. The step stops, keeping every row of the template, in four cases:
  - a conflict: rows of one `(name, locale)` that differ. Each conflict is listed in the plan and in the `--apply` report, with every candidate's row id and organization. It counts as remaining and holds back `verified_at` until the operator chooses one row with the new repeatable flag `--template-choice ROW_ID`. A choice that names no candidate, or two candidates of one conflict, is refused before anything is written. The chosen body is promoted, and the other candidates are deleted only after that promotion is verified;
  - a customized or authored row with no name;
  - an environment template that already exists and differs, since the environment's edit is never overwritten;
  - a door refusal.
- **`settings-move`** (ADR-0131 D7). Every `sys_setting` row with `scope = 'global'` and no organization is copied into `sys_platform_setting` by the database itself (`INSERT … SELECT`), so `value` and the `value_enc` secret handle move verbatim. The destination row is read back, and only when it equals the source does the row leave `sys_setting`. A key `sys_platform_setting` already holds with the same value is only removed from `sys_setting`. The step stops, moving nothing for that key, in two cases:
  - `sys_platform_setting` already holds the key with a different value (the one the runtime serves);
  - `sys_setting` holds differing rows for the key.

The `global-rung-move` departure is now executed, so it reads zero after the run and no longer holds back `verified_at`. The `declared-rule-mirrors` departure still counts until the declared-rule seeder is retired.

Mirror deletion now also deletes the promoted template rows, and only those. Before its first template delete it runs the promotion pass again, so a row customized or authored between runs (on a resumed ceremony) is promoted, not deleted. It then deletes the seeded, uncustomized mirrors and, by id, the rows whose environment copy that pass verified. Any other promotion row stays and blocks. The apply report gains `movedOut` / `movedIn` per table, and row counts reconcile as before − deleted − moved out + moved in.
