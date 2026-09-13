---
'@objectstack/runtime': minor
---

fix(runtime): `GET /api/v1/packages/:id` honours `?version=` instead of silently ignoring it (#17416)

The route accepted a `?version=` query parameter and the only surface serving it
never read the parameter. A caller asking for a version that is not installed
was answered `200` with the **installed** row, and nothing in the status,
headers or body distinguished that from a version-scoped read that actually
happened.

The parameter is not hypothetical traffic: `ScopedEnvironmentClient.packages.get`
(`@objectstack/client`) declares `version?: string` and appends it, so the SDK
has been sending a parameter the runtime dropped. The handler that honoured it
— the REST registrar's twin of this route — was removed with the duplicate
response shape, and the dispatcher's `/packages` domain never had that read to
inherit.

```
FROM  GET /api/v1/packages/com.acme.crm?version=99.0.0   (1.0.0 installed)
      -> 200 { data: { manifest: { version: "1.0.0" }, … } }

TO    GET /api/v1/packages/com.acme.crm?version=99.0.0
      -> 404 { error: { message: "Package 'com.acme.crm' version '99.0.0' not
                                  found — installed version is '1.0.0'" } }
```

**What does not change.** The unversioned read is untouched, down to the row and
the writability verdict it stamps — pinned as the lit control beside the new
assertions, because a green on only the scoped path would also pass with the
ordinary read broken. `?version=` naming the installed version is served
exactly as the unversioned read is, and so is `?version=latest`: the deleted
handler read `requested.value || 'latest'` and its store resolved `latest` to
the newest row, so "no version" and "`latest`" named one request there and name
one request here. An id the registry does not hold keeps its existing 404
wording whether or not `?version=` rode along — a package that is not installed
cannot be at the wrong version.

**This is request-side only.** The response shape is not touched, so the route
still answers with exactly one body shape; comparison is exact string equality
on the version, the same predicate the durable package store uses (`AND version
= ?`), so the two answers to "is this package at version v" cannot drift into
semver-range semantics at one of them.

A repeated `?version=a&version=b` is no longer resolved by silently choosing
one — it is answered with a refusal naming what was seen. The repo's one rule
for a repeated single-valued parameter answers `400 VALIDATION_ERROR` and is
the right end state for this door too; it is not restated here, because the
helper that owns that rule and its message is not exported from
`@objectstack/rest`.
