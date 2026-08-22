---
"@objectstack/rest": patch
"@objectstack/service-datasource": patch
---

fix(rest): `POST /datasources/:name/external/validate` does URL-scoped work (#10537)

The route asked the `external-datasource` service for `validateAll()` — every
federated object on every federated datasource, each validation driving a live
`introspect(datasource)` remote-schema read — and then kept only the rows whose
`datasource` matched the URL. The rows it kept were correct; the *work* was not
scoped, so one datasource's health check paid for N datasources' remote
round-trips and threw most of the measurement away. An unreachable *unrelated*
remote slowed the answer for the datasource actually asked about (and produced
rows that were then filtered off).

Measured at the branch point, through the real Hono adapter and the real
`ExternalDatasourceService` over a recording introspector: a request for one of
three federated datasources introspected `['wh_a', 'wh_b', 'wh_c']`. A request
naming a datasource that does not exist introspected all three as well, to
answer the empty report it already answered.

`ExternalDatasourceService` now carries `validateDatasource(datasource)`, the
scoped twin of the sweep composed from the same primitives (`listObjects` →
filter → `validateObject`) and the same per-object catch, and the route calls
it. Same request answers `['wh_a']`; an unknown name answers `[]`.

**No response change.** The rows the post-filter used to keep are the rows the
scoped composition returns — same objects, same diffs, same `data.ok` verdict,
same `200`, the same `400 EXTERNAL_DATASOURCE_ERROR` when the service refuses,
the same `503 SERVICE_UNAVAILABLE` when federation is not wired in, and an
unknown `:name` still answers an empty, vacuously `ok` report rather than a
`404`. The selection is keyed on `o.datasource ?? 'default'`, which is exactly
the value `validateObject` reports back as `result.datasource`, so "the rows the
sweep would have kept" and "the objects this selects" are the same set — pinned
directly, in both packages, by comparing the scoped answer against the
sweep-then-filter answer rather than against a remembered body.

Because the output was already right, the pins that matter here are about the
CALL RECORD, not the body: `external-datasource-validate-scope.test.ts` asserts
which datasources were introspected and that `validateAll()` is not called at
all, over a fixture carrying three federated datasources so the assertion can
actually fail. A body-only test passes on both sides of this change.

`validateDatasource` is **not** on `IExternalDatasourceService`: the contract
offers `validateObject(objectName)` and `validateAll()`, and adding a
per-datasource spelling to it is a spec-surface decision to take on its own
terms. The composition therefore lives in the service — the only registrant of
the `external-datasource` slot — and the REST registrar probes for it. A wired
service with no scoped spelling takes the same `503` arm every other route in
this family takes when the service cannot serve it, deliberately *not* a silent
fallback to the fan-out: a fallback would leave the old behaviour reachable on a
path no test drives.

Unchanged: `validateAll()` itself, and the boot-validation sweep in
`packages/runtime` that legitimately validates every federated object.
