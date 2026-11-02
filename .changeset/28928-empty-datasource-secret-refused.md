---
'@objectstack/service-datasource': patch
---

fix(service-datasource)!: the datasource admin doors refuse an empty `secret` instead of sealing it over the working credential

Clause-②: no (narrowing) — `POST /api/v1/datasources` and `PATCH /api/v1/datasources/:name` refuse one body that used to answer 201 / 200: a `secret` whose value is the empty string (`"secret": ""` or `"secret": { "value": "" }`), now `400 DATASOURCE_ADMIN_ERROR` naming `secret`. No new error code, no new answer member, no exported type changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: secret is the doors' own credential channel, split off the body before the datasource draft is judged. The refused value stored nothing usable, and a row sealed with it before is reported at connect with a reason that says the credential is empty, so there is nothing at rest for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the datasource admin doors (`@objectstack/service-datasource`): an empty `secret` is refused.

- **Before.** An empty `secret` was taken as a value. A create sealed it as the datasource's credential. An edit took it as a rotation: a new `sys_secret` row holding an empty value, `external.credentialsRef` repointed at it, and the working row removed. The live pool kept serving, so the datasource broke only at its next connect, with the old credential already gone.
- **Now.** Both doors refuse it before anything is written: no `sys_secret` row is written, the stored record and its `credentialsRef` are unchanged, and no row is removed. A whitespace-only value is still a value, sealed and used as sent. `null` and an absent `secret` keep the stored credential, as before.
- **Rows sealed before.** A datasource whose stored credential decrypts to an empty value still fails closed at connect (`failed-credentials`), and its status reason now says the credential is empty instead of blaming a missing `sys_secret` row or a changed encryption key.
- **Who moves.** The console sends `secret` only when the field holds a value, so it never sent an empty one. A script or SDK call that sends `"secret": ""` to mean "no change" gets the 400.

**The remedy.** To keep the stored credential, leave `secret` out of the request (or send `null`). To replace it, send the new credential.
