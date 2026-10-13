---
'@objectstack/rest': patch
---

Six by-name `/meta` doors now refuse a query parameter they do not read, with a located `400 VALIDATION_ERROR`, instead of dropping it. Each read the names it knew and ignored the rest, so a request carrying the bundle member selector `?member=` — which `GET`, `DELETE`, `/history`, `/publish` and `/rollback` on `/meta/:type/:name` accept — was answered for the canonical member with a `200`, and a save wrote the body's member.

Clause-②: no

What each door accepts, and what to do when it refuses:

- `PUT /meta/:type/:name` accepts `force`, `package` and `mode`. A save is addressed by its body: to save one member of a bundled type, put that member's own discriminator in the body (an `email_template`'s `locale`) and drop `?member=`.
- `GET /meta/:type/:name/layers` accepts `package`. It shows the canonical member's layers. Read one member with `GET /meta/:type/:name?member=…`.
- `GET /meta/:type/:name/audit` accepts `limit`. The trail is the item's, with every member's attempts in it. Drop `?member=`.
- `GET /meta/:type/:name/diff` accepts `from`, `to`, `fromVersion` and `toVersion`. It compares the canonical member's versions. Read one member's lineage with `GET /meta/:type/:name/history?member=…`.
- `GET /meta/:type/:name/published` and `GET /meta/:type/:name/references` accept no query parameter. Send none. Their refusal ends "This endpoint takes no query parameters." where the other doors list the names they accept.

The refusal body is the nested envelope the five member doors already answer for a name they do not know, `{ error: { code: 'VALIDATION_ERROR', message } }`, and the message names the refused parameter. A request that sends only names the door reads is answered exactly as before. The `@objectstack/client` SDK and the Studio metadata client send only accepted names.
