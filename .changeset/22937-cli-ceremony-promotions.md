---
'@objectstack/cli': minor
---

feat(cli): `os migrate organization-ownership --apply` promotes customized email templates and moves the settings global rung (ADR-0131 D10)

Clause-②: yes (widening)

Two steps join the ceremony, after the authored catalog conversion and before the verified id→name rewrite. Each is checkpointed and resumable like the others.

- **`template-promotion`** (ruling C on ADR-0131 §6 Q1). Every `sys_email_template` row the mirror deletion keeps for it (customized, or with `customized` unknown, and every row no seeder wrote: `managed_by` NULL or other than package / platform / system, with or without an organization) becomes an environment `email_template` item through the metadata door, one per `(name, locale)`, before mirror deletion removes the rows. Seeded, uncustomized copies are not promoted. A promotion that already landed is skipped. The step stops, keeping every row, in three cases:
  - two rows of one `(name, locale)` that differ;
  - an environment template that already exists and differs, since the environment's edit is never overwritten;
  - a door refusal.

  Under a walled posture the rows are kept and not promoted: promoting them would apply one organization's edit to every organization. They count as remaining and are named as a `template-promotion` departure, so the ceremony's `verified_at` stays null.
- **`settings-move`** (ADR-0131 D7). Every `sys_setting` row with `scope = 'global'` is copied into `sys_platform_setting` by the database itself (`INSERT … SELECT`), so `value` and the `value_enc` secret handle move verbatim. The row then leaves `sys_setting`. A key `sys_platform_setting` already holds with the same value is only removed from `sys_setting`. The step stops, moving nothing for that key, in two cases:
  - `sys_platform_setting` already holds the key with a different value (the one the runtime serves);
  - `sys_setting` holds differing rows for the key.

The `global-rung-move` departure is now executed, so it reads zero after the run and no longer holds back `verified_at`. The `declared-rule-mirrors` departure still counts until the declared-rule seeder is retired.

Mirror deletion now also deletes the promoted template rows: under `single`, once the promotion step has finished, every remaining `sys_email_template` row is a mirror. The apply report gains `movedOut` / `movedIn` per table, and row counts reconcile as before − deleted − moved out + moved in.
