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
