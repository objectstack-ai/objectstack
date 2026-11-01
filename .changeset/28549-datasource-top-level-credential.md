---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: `POST /api/v1/datasources` and `PATCH /api/v1/datasources/:name` refuse a top-level `password` or `connectionString` by name, with the build door's prescription, instead of dropping it and answering success

Clause-②: no (narrowing) — a create or edit body that carries `password` or `connectionString` at its top level, which answered 201 / 200 with the key silently dropped, is refused with `400 DATASOURCE_ADMIN_ERROR`. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the admin write doors now refuse two top-level keys that `DatasourceSchema` already refuses at the build door, with that schema's own message. A refused body was never stored (the key was dropped), so there is nothing at rest for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the datasource admin write doors (`@objectstack/service-datasource`).

- **Before.** The doors built the stored record from its known keys only, so a `password` or a `connectionString` written at the top level of the body vanished and the write answered success. The author got a datasource that could not connect and no explanation, while `os compile` refused the same datasource by name.
- **Now.** Either key at the top level of a create or edit body is refused before anything is read or written, naming the key and never its value. The message is `DatasourceSchema`'s own refusal for that key, the one `os compile` prints: a `password` is bound through the connection form's secret field or `external.credentialsRef`; a `connectionString` belongs in `config` as `url`. An edit is refused even when it touches only `label` or `active`.
- **Unchanged.** A credential sent as `secret` is still stored in the secret store and bound at `external.credentialsRef`. `config.password` keeps the driver contract's refusal. Other unknown top-level keys are still dropped as before.

**The remedy.** Send the credential as `secret` (the connection form's secret field), or move a connection string into `config.url` without userinfo.
