---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: `POST /api/v1/datasources/test`, `POST /api/v1/datasources` and `PATCH /api/v1/datasources/:name` refuse every top-level key `DatasourceSchema` refuses, with that schema's own message, instead of dropping it

Clause-②: no (narrowing) — a test, create or edit body carrying a top-level key the datasource schema does not declare (a `password` on the test door; on all three doors a `url` or `host` one level too high, an alias such as `type`, a retired block such as `readReplicas`, or any unknown key), which the test door probed without and the write doors answered 201 / 200 with the key silently dropped, is refused with `400 DATASOURCE_ADMIN_ERROR`. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the datasource admin doors now refuse the top-level keys that `DatasourceSchema` already refuses at the build door, with that schema's own message. A refused body was never stored (the key was dropped), so there is nothing at rest for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the datasource admin doors (`@objectstack/service-datasource`).

- **Before.** The unsaved-draft probe and the two write doors built their record from its known keys only. A top-level `password` on the probe vanished, so the probe tested a different connection than the one described. On all three doors any other key the strict schema refuses vanished the same way, and the write answered success.
- **Now.** A top-level key `DatasourceSchema` does not declare is refused before anything is read, written or probed, naming the key and never its value. The message is the schema's own refusal, the one `os compile` prints: for example `url` belongs inside `config`, `type` is `driver`, `readReplicas` is retired. The test door answers under the heading `This connection draft is not a valid datasource.`; create and edit under `Invalid datasource 'NAME'.`. This supersedes the "other unknown top-level keys are still dropped as before" line of the #28549 entry.
- **Unchanged.** Keys the schema declares pass the check, including the ones the doors do not store (`origin`, `description`, `ssl`, `autoConnect`). A credential sent as `secret` is still split off by the route and bound at `external.credentialsRef`. The probe's other answers (`ok: false` with a reason) are unchanged.

**The remedy.** Remove the key, or move it where the message says: connection keys into `config`, the credential into `secret`. Keys copied from a `GET /api/v1/datasources` or `GET /api/v1/datasources/NAME` answer that the schema does not declare (`hasSecret`, `redactedConfigKeys`, `definedIn`, `status`, `statusReason`) are not sent back on an edit.
