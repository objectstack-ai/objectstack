---
"@objectstack/service-datasource": patch
---

fix(security): the datasource-admin HTTP family requires authentication (#9391)

Every route `registerDatasourceAdminRoutes` mounts under `/api/v1/datasources`
— the list, the single read, the driver catalog, remote-table introspection,
the two connection probes, the credential migration, and create / patch /
remove — now answers `401 UNAUTHENTICATED` to a caller whose identity cannot be
resolved. The refusal is made before any service is resolved and before any
handler body runs, so an anonymous request reaches neither the datasource
lifecycle nor a configured remote.

This family mounts straight onto `IHttpServer` from a plugin `init()`, which is
outside both seams that produce the platform's 401s: the REST server's
`enforceAuth` runs inside `RestServer`'s own handlers, and the dispatcher
domains' anonymous floor runs inside the dispatcher. Neither is a middleware a
direct mount can be routed through, and the registrar carried no check of its
own — so on a server where `/api/v1/data`, `/api/v1/meta`, `/api/v1/batch` and
`/api/v1/security/explain` all refuse an anonymous caller, this one family did
not.

The guard imports rather than restates both halves of the decision:
`shouldDenyAnonymous` (the one anonymous-deny decision every HTTP seam shares,
so this family cannot drift on who counts as anonymous) over
`resolveAuthzContext` (the one identity resolution `RestServer` and the runtime
dispatcher perform, so every credential kind the platform admits — better-auth
session and `sys_api_key` alike — is admitted here too). It fails closed:
anything that throws or resolves to no identity is refused, and there is no
posture, config key or absent service that opens the routes.

**Why this is a fix and not a feature, and why `patch` rather than a breaking
bump.** The change only ever narrows the accept set: every request admitted
after it was admitted before, and the requests it now refuses are exactly the
ones every sibling family already refuses. Nothing authorable is renamed,
retired or tombstoned, and no declared contract changes shape — the routes'
paths, request bodies, success payloads and existing failure codes are
untouched, so there is no ADR-0087 conversion to register and no upgrade
prescription to write. What changes is that a declared expectation starts being
enforced. A caller that depended on reaching platform datasource configuration
with no credential was depending on the defect.

Authentication is the whole of it. Whether these routes should further require
a platform-configuration capability is a separate, separately-ruled question
(#9593) and is deliberately not anticipated here.

Pinned by a both-sides test on one boot (`admin-routes-auth-guard.test.ts`): an
anonymous caller is refused on every read and on every write verb, and an
entitled caller still succeeds on the same routes in the same run — the second
half being what distinguishes a guarded family from a broken one.
