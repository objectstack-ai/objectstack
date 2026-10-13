---
'@objectstack/core': minor
---

feat(core): `emailTemplateDefinitionFromRow` — a `sys_email_template` row as the `email_template` definition it carries (ADR-0131 D10, ruling C on §6 Q1)

Clause-②: yes (widening)

A new pure export beside `permissionSetDefinitionFromRow` and `positionDefinitionFromRow`: one row in, one body out, with no engine, no I/O and no import. The upgrade ceremony (`os migrate organization-ownership --apply`) uses it to promote a customized or admin-authored template row to an environment `email_template` item through the metadata door before the row is deleted. It runs only in that ceremony, never at boot.

The mapping: `body_html` → `bodyHtml`, `body_text` → `bodyText`, `from_address` / `from_name` → `fromOverride`, `reply_to` → `replyTo`, `variables_json` → `variables`, and `active` keeps its stored meaning. `label` falls back to the name and `locale` to `en-US`. The retired `category` / `is_system` columns and every provenance or state column are left out. It does not validate; the door does.

Nothing existing changes.
