---
'@objectstack/spec': minor
---

feat(spec): an API-backed datasource names a declared connector instance in `external.connector` and borrows its credential

Clause-②: yes
Metadata-protocol: added

A datasource over a vendor API (a plugin-contributed driver such as OData) can now authenticate with the credential of a connector instance the stack already declares, instead of a second secret of its own:

```ts
connectors: [{ name: 'sap_s4', label: 'SAP S/4HANA', type: 'api', provider: 'openapi',
  providerConfig: { spec: './sap-openapi.json' }, auth: { type: 'bearer', credentialRef: 'sap_token' } }],
datasources: [{ name: 'sap_orders', driver: 'odata', config: { serviceUrl: '…' },
  schemaMode: 'external', external: { connector: 'sap_s4' } }],
```

One Connect per vendor then serves both the connector's flow actions and the datasource's virtual objects (ADR-0015 amendment D7). The key is refused where it cannot work, each refusal naming the fix:

- beside a bound `external.credentialsRef` — the two credential channels are exclusive;
- on a built-in database driver (`postgres`, `mysql`, `sqlite`, `mongodb`, …) — a connector lends an HTTP credential; bind the database secret with `credentialsRef`;
- on a managed datasource — set `schemaMode: 'external'` (or `'validate-only'`);
- at `defineStack` (and so `os validate`) when the stack declares no `connectors` entry of that name, when the entry has no `provider` (a catalog descriptor), or when the instance declares no `auth` credential.

Nothing changes for an existing datasource: `credentialsRef` keeps its meaning in every schema mode. The runtime that hands the instance's credential to the driver ships separately; until it does, the key is validated and not yet read.
