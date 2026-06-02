# @objectstack/service-datasource-admin

Runtime **UI-created datasource lifecycle** — the "Add Datasource" wizard backend
from **ADR-0015 Addendum**. This package is the open-source **mechanism**:
list / test-connection / create / update / remove datasources that an admin
defines *in the UI* at runtime (as opposed to code-defined `*.datasource.ts`).

It deliberately ships **no managed credential vault and no multi-tenant overlay**.
Both are injected through stable seams, so a private host can layer enterprise
behaviour on without forking:

- **credentials** → a host-provided `SecretBinder` over any `ICryptoProvider`.
  The framework default uses `InMemoryCryptoProvider` (dev / self-host, single
  node). A managed host swaps in a KMS/Vault-backed `ICryptoProvider` for
  rotation, per-tenant isolation and compliance.
- **drivers** → a swappable `IDatasourceDriverFactory`. The default factory
  covers `postgres` / `sqlite` / `mongodb` / `memory`; a host can register a
  factory that adds premium drivers (Salesforce / SAP / Oracle / …).

The tier line therefore falls on *which `ICryptoProvider` / driver factory you
inject* — a neutral, technical seam — not on whether the UI can manage
datasources at all.

## Scope

Two orthogonal axes of "datasource":

| Axis | `origin: 'code'` | `origin: 'runtime'` |
|------|------------------|---------------------|
| Defined by | `*.datasource.ts` (GitOps) | the UI wizard, at runtime |
| Mutable at runtime | no (read-only) | yes |
| Stored in | code / artefacts | `sys_metadata` + secret in `sys_secret` |

**This package owns only the `origin: 'runtime'` lifecycle.** *Federation*
(introspect / draft / import / validate of external tables, ADR-0015 main body)
lives in `@objectstack/service-external-datasource`.

## Contents

- `DatasourceAdminService` + `DatasourceAdminServicePlugin` — registers the
  `'datasource-admin'` kernel service.
- `createDefaultDatasourceDriverFactory` — postgres / sqlite / mongodb / memory
  factory used to probe a connection and hot-register a pool.
- `createDatasourceSecretBinder` — fail-closed `sys_secret` binder over an
  `ICryptoProvider`; only an opaque `credentialsRef` is ever persisted, never
  cleartext. With no binder wired, secret-bearing create/update throws.
- `registerDatasourceAdminRoutes` — REST routes under `/api/v1/datasources`.
- `contracts/` — `IDatasourceAdminService`, `IDatasourceDriverFactory` + DTOs.

## Host wiring

```ts
import {
  DatasourceAdminServicePlugin,
  createDefaultDatasourceDriverFactory,
  createDatasourceSecretBinder,
  registerDatasourceAdminRoutes,
} from '@objectstack/service-datasource-admin';
import { InMemoryCryptoProvider } from '@objectstack/service-settings';

// 1. secret binder (fail-closed: no crypto provider ⇒ secret-bearing
//    create/update throws instead of persisting cleartext).
//    A managed host swaps InMemoryCryptoProvider for a KMS/Vault provider.
const cryptoProvider = new InMemoryCryptoProvider();
const lazyEngine = {
  insert: (o, d, opt) => kernel.getService('data').insert(o, d, opt),
  delete: (o, opt) => kernel.getService('data').delete(o, opt),
  find:   (o, q)   => kernel.getService('data').find(o, q),
};
const secrets = createDatasourceSecretBinder({ engine: lazyEngine, cryptoProvider });

// 2. plugin (driverFactory + secrets are the enterprise injection points)
await kernel.use(
  new DatasourceAdminServicePlugin({
    driverFactory: createDefaultDatasourceDriverFactory(),
    secrets,
  }),
);

// 3. REST routes (mount alongside the federation routes)
registerDatasourceAdminRoutes(httpServer, pluginContext, '/api/v1');
```

`@objectstack/core` and `@objectstack/spec` are required deps; the driver
packages are optional peers (imported lazily only for the drivers you use).
