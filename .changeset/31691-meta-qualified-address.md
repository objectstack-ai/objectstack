---
'@objectstack/core': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
---

feat(metadata-protocol)!: `/meta` reads an item by its namespace or `_env`, `?package=X` is the exact qualifier, and a namespace never spells an address literal (ADR-0150 D5)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which item a by-name read answers and which namespaces an install admits, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

`GET /api/v1/meta/:type/:ns/:name` reads the item a namespace's package holds, and `GET /api/v1/meta/:type/_env/:name` the environment's own item, on both transports (the REST route manager and the runtime dispatcher). Each is the item read itself with its holder named exactly. A sub-resource segment in the last position keeps its route: `/meta/app/crm/history` is still the history of the app `crm`; an item named `history` is read with `?package=`.

**BREAKING** for four answers that were a guess or a wrong status, now refused naming every holder (first-party count: 0 in the four example apps; the Studio reads at a customization pair, `?package=<app>.custom`, keep their answer):

1. `?package=X` on `GET /meta/:type/:name` for an app, page, dashboard, report, book, analytics cube, tool, skill or agent that `X` does not hold was served another package's item (the first registered). It is now `409 RESOURCE_CONFLICT` naming the holders. A customization pair counts as holding its base's items and its own added members.
2. On the runtime dispatcher, a bare read of a name two packages hold fell through to the by-name metadata service read after the protocol refused it. It is now the protocol's `409 RESOURCE_CONFLICT`, as on the REST transport.
3. `POST /security/_activation/:type/:name` answered a sharing rule or queue name two packages declare `503 SERVICE_UNAVAILABLE` ("could not be read"), and switched off the first-listed of two assignment rules. Both are now `409 RESOURCE_CONFLICT` with every candidate in `details.candidates`, and nothing is written.
4. A package whose namespace is `actions`, `connectors`, `global`, `hooks`, `oauth` or `trigger` is refused at install, `422 NAMESPACE_CONFLICT`: the router reads those segments as routes before any namespace.

Also: a `PUT`, `POST` or `DELETE` on a path of the qualified read's shape (`/meta/:type/:x/:y`, no route for that verb) now answers `405 METHOD_NOT_ALLOWED` with `Allow: GET, HEAD` where it answered 404, because the shape now has a GET route.

The fix for each:

- FROM `?package=X` for a name X does not hold TO the package that holds it (the refusal names it), or the qualified path `/meta/:type/<its namespace>/:name`.
- FROM a bare read of a two-holder name TO `?package=<id>` or `/meta/:type/<namespace>/:name`.
- FROM switching a two-holder declared name TO renaming one of them; the ledger addresses an item by name.
- FROM a namespace spelling an address literal TO any other namespace.
