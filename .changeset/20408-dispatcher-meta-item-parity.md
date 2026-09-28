---
'@objectstack/rest': minor
'@objectstack/runtime': patch
---

fix(rest, runtime): the runtime dispatcher's `/meta` doors scope a caller to the organization `RestServer` scopes them to, and its item read, book tree and list answer what `RestServer`'s answer (#20408)

Clause-②: yes (widening) — `@objectstack/rest`'s root entry gains seven value exports (`createMetaItemAnswer`, `createMetaBookTreeAnswer`, `metaCallerOrganizationId`, `metaReadOrganizationId`, `projectMetaObjectSchema`, `refuseUnknownMetaListType`, `translateMetaEnvelope`) and five type exports (`MetaItemAnswer`, `MetaItemAnswerSources`, `MetaItemRequest`, `MetaBookTreeAnswer`, `MetaBookTreeSources`), and `MetaListAnswer` gains an optional `cacheControl`. `MetaListAnswerSources`, new in this same release with `createMetaListAnswer`, takes the transport's object-schema masker (`resolveObjectMasker`) instead of a whole-mask port, so the chain decides the cache posture for both transports. Nothing any published version exported is removed, renamed or narrowed. `@objectstack/runtime` publishes no new surface and stays a `patch`.

A host that mounts only the `${prefix}/*` catch-all (`createHonoApp`, and any
adapter written on the public `HttpDispatcher` API) serves `/meta` through the
runtime dispatcher. Until now, on such a host:

- **A member removed from an organization kept its metadata partition.** The
  dispatcher's `/meta` doors took the organization from the session's
  `activeOrganizationId` as stored. Under a wall-enforcing tenancy posture the
  identity resolver DROPS a claim naming an organization the caller no longer
  belongs to, and `RestServer` reads that vetted value. The dispatcher did not,
  so for the rest of the session the removed member was served that
  organization's org-scoped overlays (`view`, `dashboard`, `report`,
  `translation`, `email_template`) by the item read, the list, `/published` and
  `?state=draft`, listed its pending drafts on `GET /meta/_drafts`, and had a
  `PUT /meta/:type/:name` land in its partition. Every `/meta` door here now reads
  the vetted organization on the execution context, the value `RestServer` reads.
- **`GET /meta/:type/:name` answered a different body.** Nothing was translated
  whatever `Accept-Language` or `?locale=` asked for. A doc kept its whole
  `translations` map, in no locale. An object schema came with no
  `sortability`. The answer had no `Vary: Accept-Language`.
- **`?preview=DRAFT`** (any casing but lower) from a builder read the published
  world on the item read and the list. `RestServer` compares it
  case-insensitively.
- **`GET /meta/object/:name?preview=draft`** from a builder answered the ACTIVE
  schema, never the pending draft.
- **`GET /meta/totally_invented_type`** answered `200 {"items": []}`. `RestServer`
  refuses a segment that names no metadata type with `400 INVALID_REQUEST`.
- **`GET /meta/book/:name/tree`** was no route: `404 ROUTE_NOT_FOUND` to a signed-in
  reader and `401` to an anonymous reader of a `public` book (ADR-0046 §6.7).
- **An object schema served under an undetermined field visibility** (ADR-0106
  D6 tier 2: served unmasked) carried no `Cache-Control`. `RestServer` answers
  `private, no-store`. This was true of the list, the item read, `/published` and
  the legacy one-segment object read.

**What changed.** Everything `RestServer`'s `GET /meta/:type/:name` does after
the store read moved, unchanged, into `createMetaItemAnswer`: absence, the item
gate, the doc locale collapse, the object mask and its cache posture, and the
body (the translation and `sortability`, `translateMetaEnvelope`). The book-tree
route's whole answer moved into `createMetaBookTreeAnswer`, and the list's
unknown-type refusal into `refuseUnknownMetaListType`. The list chain now
applies the object mask itself (`projectMetaObjectSchema`) and reports the cache
posture. The dispatcher's `/meta` domain calls each of these, and takes its
organization from `metaCallerOrganizationId` / `metaReadOrganizationId`, which
`RestServer`'s list and item reads ask too.

`RestServer`'s own answers are unchanged: the move is a refactor on that side,
and every existing REST test passes unedited.
