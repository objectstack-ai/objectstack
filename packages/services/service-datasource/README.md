# @objectstack/service-datasource

The datasource service (ADR-0015). One package, two cohesive halves of the same
capability:

| Half | ADR-0015 | What it does | Plugin |
|------|----------|--------------|--------|
| **Federation** | main body | introspect / draft / import / validate external tables | `ExternalDatasourceServicePlugin` |
| **Runtime admin** | Addendum | the "Add Datasource" wizard backend — list / test / create / update / remove datasources defined in the UI at runtime, + REST routes under `/api/v1/datasources` | `DatasourceAdminServicePlugin` |

(Previously shipped as the separate `@objectstack/service-external-datasource`
and `@objectstack/service-datasource-admin` packages. The split existed only
because the runtime admin was once private; now that both are open-source, they
are one package. The two plugins still mount independently — merging the package
did not couple them.)

## Open-source mechanism, injectable tier line

This package is mechanism only. Credential storage is delegated to a
host-provided `SecretBinder` over any `ICryptoProvider` (framework default:
`InMemoryCryptoProvider`), and drivers to a swappable factory. The tier line
falls on *which crypto provider / driver factory a host injects* — a neutral,
technical seam — so a managed credential vault + multi-tenant overlay can be
layered on by a private host **without forking**.

## Two axes of "datasource"

| Axis | `origin: 'code'` | `origin: 'runtime'` |
|------|------------------|---------------------|
| Defined by | `*.datasource.ts` (GitOps) | the UI wizard, at runtime |
| Mutable at runtime | no (read-only) | yes |
| Stored in | code / artefacts | `sys_metadata` + secret in `sys_secret` |

The runtime admin owns only the `origin: 'runtime'` lifecycle.

## REST routes

Mounted under `/api/v1/datasources` by `registerDatasourceAdminRoutes` (lifecycle
+ introspection) and the federation routes by the external service. Every route
degrades gracefully (`503` / "unavailable") when its service isn't wired, and the
message names **that** service — one registrar, but two services behind it: the
three routes marked below dispatch to `external-datasource`, the rest to
`datasource-admin` (#4225). A refusal (`400`) carries the same attribution
machine-readably: `error.code` is `DATASOURCE_ADMIN_ERROR` from the
datasource-admin routes and `EXTERNAL_DATASOURCE_ERROR` from the
external-datasource ones (#4249) — both registered in the ADR-0112 ledger.

**Lifecycle & connection**
- `GET    /datasources` — list (code + runtime, with provenance/health)
- `GET    /datasources/drivers` — driver catalog + per-driver JSON-Schema `configSchema` (drives the Studio connection form)
- `GET    /datasources/:name` — one datasource's detail, **credential-stripped** (`config` + `hasSecret`)
- `POST   /datasources` — create a runtime datasource
- `PATCH  /datasources/:name` — update a runtime datasource
- `DELETE /datasources/:name` — remove a runtime datasource (blocked while objects are bound)
- `POST   /datasources/test` — probe an unsaved draft (inline body)
- `POST   /datasources/:name/test` — probe a **saved** datasource by name (backs the `test_connection` action) — *`external-datasource`*

**Introspection / sync (read-only)** — all on `external-datasource`
- `GET    /datasources/:name/remote-tables` — list remote tables
- `POST   /datasources/:name/object-draft` — generate an object definition draft for one table (no persistence)
- federation import/validate/refresh routes under `/datasources/:name/external/*` (ADR-0015)

Credentials never travel in `config`: a `format:'password'` field is split into
the top-level `secret` on write (encrypted to `sys_secret`), and reads never
echo it (`hasSecret` only).

## Studio integration

`datasource` is a metadata type, so it is administered through the generic
metadata-admin engine (not a bespoke page): the `DatasourceAdminServicePlugin`
contributes a **Datasources** entry to the Setup app's `group_integrations` nav
slot (→ the engine route `…/component/metadata/resource?type=datasource`), where
the list/create/edit/test/**sync objects**/delete UI lives. Runtime records are
persisted to `sys_metadata` and restored (pools rehydrated) on restart.

## Exports

- Federation: `ExternalDatasourceService`, `ExternalDatasourceServicePlugin`.
- Runtime admin: `DatasourceAdminService`, `DatasourceAdminServicePlugin`,
  `createDefaultDatasourceDriverFactory`, `createDatasourceSecretBinder`,
  `registerDatasourceAdminRoutes`.
- `@objectstack/service-datasource/contracts` — `IDatasourceAdminService`,
  `IDatasourceDriverFactory` + DTOs.

`os serve` wires both by default. For manual host wiring of the admin half
(secret binder over a crypto provider, driver factory, REST routes), see the
serve composition root in `@objectstack/cli`.

`@objectstack/core` and `@objectstack/spec` are required deps; the driver
packages are optional peers (imported lazily only for the drivers you use).
