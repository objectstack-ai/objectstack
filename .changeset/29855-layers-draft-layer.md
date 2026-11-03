---
'@objectstack/spec': minor
---

feat(spec): the `/layers` answer declares the pending draft as a layer, `draft`, as stored

Clause-②: yes (widening)
Metadata-protocol: added

`GetMetaItemLayeredResponseSchema`, the body of `GET /api/v1/meta/:type/:name/layers`, gains an optional `draft` member beside `code`, `overlay` and `effective`. It is the pending draft row exactly as stored: untranslated, ungoverned, with no injected platform columns. It is scoped to the requested `packageId` when one is given, and `null` when no draft is pending. The ordinary `?state=draft` item read still answers the draft translated for the caller's locale and governed; an editor that builds its edit buffer from that body and saves it back writes the translations and the injected columns into the author's draft. A client building an edit buffer reads `draft ?? overlay ?? code` instead.

The member is optional, so an answer from a server that does not serve it still parses; absence means "not served", never "no draft". This release declares the member only: a server serves it once its `/layers` route and runtime dispatcher do.
