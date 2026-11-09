---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: a datasource update whose new configuration fails to connect stores none of it, and a whitespace-only `secret` is refused like an empty one

Clause-②: yes (narrowing) — `PATCH /api/v1/datasources/:name` and `POST /api/v1/datasources` refuse one more body that used to answer 200 / 201: a `secret` whose value is whitespace only (`"   "`, a tab and a newline), now `400 DATASOURCE_ADMIN_ERROR` with the empty-secret answer. The widening half: the `reregisterPool` member of the exported `DatasourceAdminServiceConfig` may now answer `{ previousPoolKept: boolean }` (still optional; a seam that answers nothing reads as before).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: secret is the doors' own credential channel, split off the body before the datasource draft is judged. A blank value seals nothing usable, so there is nothing at rest for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the datasource admin doors (`@objectstack/service-datasource`): a whitespace-only `secret` is refused.

- **Before.** A `PATCH` whose new configuration failed to connect (a wrong password, a blank `secret`, a changed `config` that does not reach the database) answered `200` with `status: "error"` and a reason saying the previous pool was kept and the new configuration was NOT in force. It had already stored the new record, repointed `external.credentialsRef` at a new `sys_secret` row and removed the working one, so the next restart connected the configuration that failed. A whitespace-only `secret` passed the empty-secret guard and reached this path.
- **Now.** The update rebuilds the pool before it stores anything. When the previous pool is kept, nothing of the patch is stored: the record, its `credentialsRef` and every other key of the patch stay as they were, and the `sys_secret` row sealed for the patch is removed again. The answer is unchanged (`200`, `status: "error"`, "the new configuration is NOT in force"), and now true: a restart connects the configuration that was serving. A configuration that connects is stored and in force, and the replaced secret is retired, as before. A whitespace-only `secret` is refused before anything is written, by the same guard and with the same message as the empty string; a value with whitespace around other characters is still sealed as sent.
- **Who moves.** The console sends `secret` only when the field holds a value. A script or SDK call that sends a whitespace-only `secret` gets the 400. A host that wires its own `reregisterPool` seam keeps today's behaviour until it answers `{ previousPoolKept: true }` for a rebuild that kept the previous pool.

**The remedy.** To keep the stored credential, leave `secret` out of the request (or send `null`). To replace it, send the new credential.
