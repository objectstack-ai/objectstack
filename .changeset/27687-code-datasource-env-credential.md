---
'@objectstack/service-datasource': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

feat(service-datasource): a datasource defined in code reads its credential at connect from `OS_DATASOURCE_<NAME>_PASSWORD`

Clause-②: yes (widening) — `@objectstack/service-datasource` exports `datasourceEnvCredentialVar`, `resolveDatasourceEnvCredentialsSwitch`, `DATASOURCE_ENV_CREDENTIALS_SWITCH` and the `DatasourceEnvCredentialSource` type, and `DatasourceConnectionServiceConfig` gains the optional `envCredentials`; `@objectstack/spec/data` exports `CODE_DEFINED_CREDENTIAL_ROUTE`. Nothing an author writes is added or refused.
Metadata-protocol: none

A datasource declared in code (`defineDatasource`, or a package's `*.datasource.ts`) had no way to get its password: the driver contracts refuse `config.password` and a `user:password@` URL, the Setup → Datasources form cannot edit a code datasource, and nothing mints a `sys_secret:` handle for one. Now the credential stays out of the declaration and is read at connect from a variable derived from the datasource name: `warehouse` reads `OS_DATASOURCE_WAREHOUSE_PASSWORD` (upper-cased; every character outside `A-Z0-9` becomes `_`). The value is the connection's secret: the password for postgres, mysql and mongodb, the `authToken` for turso.

- **A host switch.** `OS_DATASOURCE_ENV_CREDENTIALS` takes `on` or `off`; any other value refuses the boot with a sentence. `os serve` (and so `os start` and `os dev`) turns it on unless the operator set it. Every other composition leaves it off, so a host that loads several tenants' artifacts into one process never reads the variable.
- **Code datasources only, by provenance.** The variable is read on the boot's declared connect, for a name in the host's code-datasource set: the booted artifact's datasources and those of a package installed locally. A datasource created through Setup or the API under the same name never reads it, and neither does the `default` datasource, which keeps `OS_DATABASE_URL`. A record's own `origin` is never consulted.
- **A declared credential wins.** With `external.credentialsRef` or `external.connector` declared the variable is not read, and a reference that fails to resolve stays fail-closed.
- **Unset.** The connect goes ahead without a secret as before; when the database then refuses, the reason names the variable to set.
- **Two names deriving one variable** are refused at their connect.
- **Who can read it.** Any code datasource the host registers under a name reads that name's variable, including one in an installed package. Install only packages you trust with the credentials in the process environment.

The credential refusals (`config.password`, a URL userinfo password, a credential query parameter, the mongo `options` passthrough) and the two `password` guidance entries on `DatasourceSchema` / `ExternalDatasourceSettingsSchema` end with one shared sentence naming this route, after the Setup and `external.credentialsRef` routes they already name. `planCredentialMigration`'s remedy for a code-defined row names the row's variable.
