---
'@objectstack/metadata': patch
'@objectstack/objectql': patch
---

fix(metadata, objectql): two packages' same-named `api` items are both kept and both served, and a read of one by its package gets that package's own body (ADR-0150 D3/D5)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no `/meta/api` read at a package or `_env` that does not hold the item, and no answer for an api name two packages hold; the refusal names the holder to address.

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which item a by-name api read answers and that the in-memory store keeps each package's item, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The metadata service kept its in-memory `api` items by bare name, so when two packages (two namespaces) declared an `api` with the same name, the one registered last overwrote the other. The first package's endpoint path answered `404 ENDPOINT_NOT_FOUND`, and `GET /api/v1/meta/api/<its namespace>/<name>` (or `?package=<its id>`) answered `200` with the OTHER package's body, stamped with the requested package's `_packageId`. Each package's `api` item now has its own `(package, name)` slot: both endpoint paths are served, and a read naming a package answers that package's item, never another's. With one package holding a name, every read answers exactly as before.

`api` also joins the types whose by-name reads follow the one package-scoped rule (ADR-0150 D3) and the exact qualifier (D5), as apps, pages, dashboards, reports, books, analytics cubes, tools, skills and agents already do.

**BREAKING** for three `/meta/api` answers that served an item the address did not name (first-party count: 0 in the four example apps, which never address an api at a package that does not hold it):

1. `GET /meta/api/<name>?package=X` and `GET /meta/api/<X's namespace>/<name>`, for an api `X` does not hold, served the holder's item. It is now `409 RESOURCE_CONFLICT` naming the holders.
2. `GET /meta/api/_env/<name>`, for an api a package holds and the environment does not, served the package's item. It is now `409 RESOURCE_CONFLICT` naming the holder.
3. `GET /meta/api/<name>` of a name two packages hold served one of them. It is now `409 RESOURCE_CONFLICT` naming both. The metadata service's own `get('api', name)` with no package refuses the same way.

The fix for each:

- FROM `?package=X` or `/meta/api/<X's namespace>/<name>` for an api X does not hold TO `?package=<holder id>` or `/meta/api/<holder's namespace>/<name>` (the refusal names the holder).
- FROM `/meta/api/_env/<name>` for a package's api TO `/meta/api/<its namespace>/<name>`.
- FROM a bare read of a two-holder api name TO `?package=<id>` or `/meta/api/<namespace>/<name>`.
