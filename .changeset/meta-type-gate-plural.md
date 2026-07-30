---
"@objectstack/rest": patch
---

fix(rest): the /meta per-type gates are enforced on both spellings of the type segment (#3984)

Every per-type filter on `GET /meta/:type` and `GET /meta/:type/:name` compared
`req.params.type` to a literal SINGULAR name, while the protocol's `getMetaItems`
normalizes singular↔plural and serves either. Prime Directive #3 makes plural the
canonical REST spelling, so the form a client is most likely to use —
`/api/v1/meta/books` — reached the handler with every gate skipped.

Three of those gates are authorization:

- **ADR-0046 §6.7 book / doc audience** (three sites: the list, the single-item
  read, and the doc effective-audience union). `GET /meta/books` returned a
  `{ permissionSet }`-gated book — an *Admin Guide* — to a caller who does not
  hold the set, and `GET /meta/books/admin_guide` answered `200` where the
  singular spelling answers `401`. On a publicly-served deployment the same skip
  handed an `org` book to an anonymous reader.
- **App RBAC filter** — hides privileged apps (Studio, Setup) and gated nav
  entries from callers without the grants. `GET /meta/apps` skipped it.
- **Dashboard `requiresService` gate** (ADR-0057 D10). `GET /meta/dashboards`
  skipped it.

The remaining spelling-sensitive branches are behavioural rather than
authorization — doc i18n locale collapse, and the list-response `content` strip —
and were inconsistent between the two spellings for the same reason.

Each handler now normalizes the type ONCE (`RestServer.metaTypeSingular`, backed
by the same `PLURAL_TO_SINGULAR` table the protocol uses) and every gate keys on
that value, so the two spellings of one route can no longer diverge. Found while
scoping #3963.
