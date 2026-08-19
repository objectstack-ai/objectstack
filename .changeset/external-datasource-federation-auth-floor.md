---
"@objectstack/rest": patch
---

fix(security): the external-datasource federation HTTP family requires an authenticated caller, on every route (#9686)

<!-- adr-0087: not-required (no-migration-prescription) The change is an
authentication floor on five mounted HTTP routes plus the composition edge that
feeds it the caller's identity. No authorable metadata key is added, renamed,
retired or tombstoned, and no stored shape changes, so there is no conversion to
register. The behavioural change is that `/api/v1/datasources/:name/external/*`
now answers `401 UNAUTHENTICATED` to a caller with no resolvable identity, where
it previously served every route — including the two that write. -->

`registerExternalDatasourceRoutes` mounts the five federation routes
(`GET .../external/tables`, `POST .../external/tables/:remote/draft`,
`POST .../external/tables/:remote/import`, `POST .../external/refresh-catalog`,
`POST .../external/validate`) straight onto `IHttpServer`, so they pass through
none of the seams that produce the platform's 401s: `RestServer.enforceAuth` is
a private method invoked inside that server's own handlers — not middleware a
direct mount is routed through — and the dispatcher domains' floor runs inside
the dispatcher. Being composed by `RestServer` was not itself a guard.

**The missing piece was an edge in the composition, not a line in a handler.**
`mountAndRecordDirectRoutes` resolves the `RestServer`'s execution-context
resolver and handed it to ONE of the two registrars it mounts:
`registerPackageRoutes` got the identity and applied the shared anonymous floor,
`registerExternalDatasourceRoutes` got nothing and checked nothing. The resolver
now reaches both, and the federation registrar applies the same floor:

- the **decision** is `shouldDenyAnonymous` (`@objectstack/core`), the one
  function every HTTP seam on the platform shares — `isSystem` is not settable
  from the wire and a CORS `OPTIONS` preflight passes, both by its construction;
- the **identity** is the `RestServer`'s own resolver, which admits every
  credential kind the platform admits — a better-auth session *and* a
  `sys_api_key`. This family is SDK-expressed (`datasources.external.*` on
  `ObjectStackClient`), so a floor that read only a session would have refused
  callers the rest of the surface accepts;
- it **fails closed**: anything that throws, and anything resolving to no
  identity, is refused. No configuration, posture or absent service opens it;
- the check runs **before** the service lookup, so an anonymous caller cannot
  learn from a `503` which services a deployment has wired — and, on the two
  routes that change state, the refusal provably precedes the write;
- the 401 is written through this surface's shared `sendError`, so the status,
  code and message are the platform's while the envelope stays this family's.

**A pinned equivalence is restored, not merely an exposure closed.**
`GET .../external/tables` and `GET /api/v1/datasources/:name/remote-tables` reach
the same `listRemoteTables`; `POST .../external/tables/:remote/draft` and
`POST /api/v1/datasources/:name/object-draft` reach the same
`generateObjectDraft`. #4249 gave those two spellings one failure contract and
#7955 one request shape. After the datasource-admin family grew its own floor
(#9391), one operation answered 401 at one spelling and served anonymously at
the other. `remote-tables-twin.equivalence.test.ts` now compares the two on the
admission axis as well, so a guard added to one spelling and not the other fails
whichever side it is added to.

Authentication and nothing more: whether these routes should further require a
capability is the separately-ruled question #9593 asks of the admin family, and
is deliberately not folded in here.
