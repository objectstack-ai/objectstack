---
'@objectstack/types': patch
'@objectstack/cli': patch
'@objectstack/driver-odata': patch
---

feat: `os serve` publishes its datasource secret store's `resolve` as the kernel service `datasource-secret-resolver`, and `driver-odata` reads it when it is passed no secret store

Clause-②: yes (widening)
Metadata-protocol: none

A stack served by `os serve` that mounts `createODataDriverPlugin` could not resolve its datasource's `external.credentialsRef`: the server's `sys_secret` store was handed only to the datasource admin, so a `sys_secret:` handle stored through Setup → Datasources did not resolve for the plugin, and the stack had to pass a `resolve` of its own. It now resolves with no code:

```ts
plugins: [createODataDriverPlugin({ name: 'erp', serviceRoot: 'https://erp.example.com/odata/', auth: { scheme: 'bearer' } })],
datasources: [{ name: 'erp', driver: 'erp', config: {}, schemaMode: 'external',
  external: { credentialsRef: 'sys_secret:…' } }],
// no `secrets` option: under os serve the handle resolves through the server's own store
```

- **`@objectstack/cli`**: `os serve` registers the read half of the datasource secret binder it builds as the kernel service `datasource-secret-resolver` (plugin `com.objectstack.cli.datasource-secret-resolver`). Only `resolve` is published; storing and removing a credential stays the datasource admin's. It decrypts datasource credentials only: a settings secret or a secret field's row in `sys_secret` does not open through it. When `os serve` builds no binder (no crypto provider), the service is not registered.
- **`@objectstack/driver-odata`**: when `options.secrets` is absent, the plugin reads the `datasource-secret-resolver` service at the first request. An explicit `options.secrets` still wins. With neither, the request is refused as before, sent to nobody, and the message now names the service.
- **`@objectstack/types`**: `DATASOURCE_SECRET_RESOLVER_SERVICE` and `IDatasourceSecretResolver`, the contract a host publishes the resolver under and every plugin driver that dereferences a `credentialsRef` reads it by: an explicit store first, the service looked up at the first request (never at `init`), fail-closed when neither resolves.
