---
"@objectstack/spec": major
"@objectstack/example-showcase": patch
---

feat(spec)!: refuse inline credentials at publish — driver `config.password` / `config.authToken` and connector `authentication` on authored entries (#7990)

`sys_metadata.metadata` is served back by the ordinary data API, and a datasource or
connector artefact is persisted whole — so any schema that *accepted* an inline
credential stored that credential in cleartext at rest. The maintainer-ruled fix
(#7990, Option A: per-artefact contract closure) makes the two measured surfaces
refuse the inline form at publish and divert to the mechanisms that already exist.

**Driver config (postgres / mysql / mongo / turso).** `config.password` (SQL/mongo)
and `config.authToken` (turso) are now declared-unwritable: writing one fails `tsc`
(the input type is `never`) and fails the parse with a prescription naming the
replacement. The former alias spellings (`passwd`, `pwd`, `token`, `jwt`,
`auth_token`, `authtoken`) carry the same refusal. The connection form's masked
secret input is unaffected — it never wrote `config`; it feeds the datasource secret
binder, which encrypts into `sys_secret` and stores only an opaque handle.

**Connector authoring door.** `DeclarativeConnectorEntrySchema` (behind
`defineStack({ connectors })` and `PUT /meta/connector/:name`) now refuses a
non-`none` `authentication` on **every** authored entry — catalog descriptors
included. Until now only provider-bound instances were covered (ADR-0097 §3), so a
descriptor could publish an inline `token`/`key`/`password`/`clientSecret`. The
runtime shape is unchanged: a plugin handing resolved secrets to
`registerConnector` keeps working.

## FROM → TO

```ts
// before — accepted, stored in cleartext in sys_metadata
defineDatasource({
  name: 'warehouse', driver: 'postgres',
  config: { database: 'analytics', username: 'ro', password: 'hunter2' },
})

// after — the secret lives in the secret store; config carries no credential
defineDatasource({
  name: 'warehouse', driver: 'postgres', schemaMode: 'external',
  config: { database: 'analytics', username: 'ro' },
  external: { allowWrites: false, credentialsRef: 'sys_secret:<handle>' },
})
// (Setup → Datasources binds the secret for you: its password field encrypts into
// sys_secret and writes external.credentialsRef — it never wrote config.)
```

```ts
// before — descriptor published an inline credential
defineConnector({
  name: 'erp', label: 'ERP', type: 'saas',
  authentication: { type: 'api-key', key: '…', headerName: 'X-API-Key' },
})

// after — descriptor: no live credentials (document the scheme in prose);
defineConnector({ name: 'erp', label: 'ERP', type: 'saas',
  description: 'Authenticates with an API key in the X-API-Key header.' })
// instance: reference the credential (ADR-0097 §3)
defineConnector({ name: 'erp', label: 'ERP', type: 'saas', provider: 'openapi',
  providerConfig: { spec: './erp-openapi.json' },
  auth: { type: 'api-key', credentialRef: 'ERP_API_KEY' } })
```

There is deliberately **no automatic rewrite**: moving a cleartext credential into
`sys_secret` requires encrypting it through a running secret binder, which a
source-file transform cannot do — auto-deleting the key would silently drop a live
credential instead. `os migrate meta` surfaces both changes as structured TODOs
(semantic entries `datasource-config-inline-credential-refused`,
`connector-inline-authentication-publish-refused`). The migration story for
**already-stored** cleartext rows is programme scope, tracked as a follow-up card
under #7990 — this release closes the doors that keep writing new ones.

<!-- adr-0087: registered datasource-config-inline-credential-refused, connector-inline-authentication-publish-refused -->
