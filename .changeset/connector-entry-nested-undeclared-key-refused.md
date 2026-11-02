---
'@objectstack/spec': minor
---

feat(spec)!: an authored connector entry refuses a key `retryConfig` or an `actions` element does not declare

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-entry-nested-undeclared-key-refused -->

**BREAKING** accept-set narrowing on an authored connector entry (`DeclarativeConnectorEntrySchema`), at every door that parses it: `defineConnector()`, `defineStack({ connectors })`, `os validate` / `os compile`, the metadata plugin's artifact load at boot and on reload, and the metadata save door `PUT /api/v1/meta/connector/:name`.

- **Before.** The entry refused an undeclared top-level key, but its two nested shapes were plain objects: an undeclared key inside `retryConfig` or inside an `actions` element parsed green and meant nothing to the runtime.
- **Now.** Each is refused by name, in one `unrecognized_keys` issue located at the container (`retryConfig`, `actions.N`) that lists every undeclared key; at the save door `422 INVALID_METADATA`, and nothing is stored. An execution binding on an action (`method`, `path`, `url`) is refused the same way: an action carries none (ADR-0097 §5).
- **Unchanged.** The published open shapes — `ConnectorSchema`, `RetryConfigSchema`, `ConnectorActionSchema` — keep their posture: the def a plugin hands to `registerConnector`, the actions a provider derives, and the retry policy the runtime parses at materialization. A row stored before this refusal keeps working: the read withholds the undeclared key, and a save of the served form keeps it at rest.

## FROM → TO

```ts
// before — parsed green; `secret` was read by nothing
retryConfig: { strategy: 'exponential_backoff', maxAttempts: 3, secret: '…' },
actions: [{ key: 'get_invoice', label: 'Get invoice', method: 'GET', path: '/invoices/{id}' }],

// after — refused at retryConfig and at actions.0; keep the declared keys only
retryConfig: { strategy: 'exponential_backoff', maxAttempts: 3 },
actions: [{ key: 'get_invoice', label: 'Get invoice', effect: 'read' }],
```

A credential moves to the secrets layer under the name `auth.credentialRef` gives; an execution binding has no home on an action (a provider-bound instance derives its actions from the upstream). The upgrade guide entry is `connector-entry-nested-undeclared-key-refused`.
