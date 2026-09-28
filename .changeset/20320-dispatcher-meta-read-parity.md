---
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest, runtime): the runtime dispatcher's `/meta` reads answer what `RestServer`'s answer — one list chain, one `public`-audience predicate, and the `?state=draft` read (#20320)

Clause-②: no

A host that mounts only the `${prefix}/*` catch-all (`createHonoApp`, and any
adapter written on the public `HttpDispatcher` API) serves `/meta` through the
runtime dispatcher. Its reads now give the same answers as `RestServer`'s
`GET /meta/:type` and `GET /meta/:type/:name`. Until now a dispatcher-only host
answered:

- **`GET /meta/app?id=crm`** — every app the caller may see, not `[crm]`. An
  `?id=` that matches nothing listed every app instead of an empty list.
- **`GET /meta/view?object=lead`** — every view, not the lead views sorted for
  the switcher.
- **`GET /meta/docs`** (the plural spelling) — every doc WITH its body. The
  content slim compared the raw segment, so it ran only for `/meta/doc`.
- **any doc list** — each doc with its `translations` map and in no locale.
  `RestServer` collapses each doc to the request's locale.
- **every translatable list** (`app`, `view`, `object`, `page`, `dashboard`,
  `action`, `dataset`) — untranslated labels, whatever `Accept-Language` or
  `?locale=` asked for, and no `Vary: Accept-Language` header.
- **`GET /meta/api`** — every stored `api` declaration, including ones the
  endpoint matcher does not serve (their routes answer 404).
- **an anonymous `GET` of a `public` book or doc** (list or item) —
  `401 UNAUTHENTICATED`. `RestServer` serves it (ADR-0046 §6.7).
- **`GET /meta/:type/:name?state=draft` from a caller who may read drafts** —
  the ACTIVE item. It should be the pending draft, whole for a caller who may
  save the app and pruned per caller for everyone else, or `404 NO_DRAFT` when
  nothing is pending. A caller who may not read drafts is still answered the
  plain read, byte for byte.

**What changed.** The list route's whole post-read chain moved out of
`RestServer` into `createMetaListAnswer` in `@objectstack/rest`, unchanged. That
chain is the `api` served-set face, the per-caller list gate, `?id=`,
`?object=`, the doc locale collapse and content slim, the transport's own
object mask, and the translation. Every exit of the dispatcher's list branch
now hands its answer to that same function. The anonymous gates on both
transports ask one exported predicate, `isPublicAudienceRead`. It admits only
`GET` reads of book and doc, so every other type keeps the anonymous deny, and
the §6.7 audience gate still refuses `org` and `{ permissionSet }` audiences.
The dispatcher's `?state=draft` read runs the exported
`STORED_VERSION_DOOR_POLICY`, the constant `RestServer`'s draft branch runs.

`RestServer`'s own answers are unchanged: the move is a refactor on that side,
and every existing REST test passes unedited.

New exports from `@objectstack/rest`: `createMetaListAnswer`,
`translateMetaList`, `metaRequestLocale`, `isPublicAudienceRead`,
`STORED_VERSION_DOOR_POLICY` and their types. Nothing is removed or renamed.
