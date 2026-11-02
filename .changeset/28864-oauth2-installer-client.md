---
'@objectstack/spec': minor
---

feat(spec): an `oauth2` `authorization_code` connector instance can take its OAuth client from the administrator who installs it — `clientSource: 'installer'`

Clause-②: yes (widening)
Metadata-protocol: added
Ruling-ref: 6566728470

A vendor accepts an OAuth client only at the callback URLs its owner registered, and the platform's callback is fixed per deployment. A `clientId` written into a connector definition is the publisher's client, so an app installed on a deployment its publisher never saw could not connect there. The `authorization_code` instance shape gains one optional key that says the client comes from the installer instead:

```ts
connectors: [{
  name: 'esign',
  label: 'E-Signature',
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec: 'https://api.vendor.example.com/openapi.json' },
  auth: {
    type: 'oauth2',
    grant: 'authorization_code',
    authorizationUrl: 'https://account.vendor.example.com/oauth/authorize',
    tokenUrl: 'https://account.vendor.example.com/oauth/token',
    scopes: ['signature'],
    clientSource: 'installer',
  },
}]
```

- **What it means.** The administrator of each deployment registers their own client with the vendor, against that deployment's callback, and enters its id and secret on the instance's connection. The definition names no client and no secret.
- **What it refuses.** A `clientId` beside `clientSource` is refused at publish, located at `auth.clientId`: the definition would name two clients. A `credentialRef` without its `clientId` is refused as before, and its message now names this form. An unknown value is refused at `auth.clientSource`. On `grant: 'client_credentials'` the key is refused with guidance, because that grant keeps no connection to enter a client on.
- **What it does not change.** The endpoints stay declared, or discovered on `provider: 'mcp'` over http: the installer owns the client, not the vendor's authorization server. An instance that names a pre-registered `clientId` without the key parses exactly as before. That form is kept for an app whose author registers the callback of every deployment that installs it, such as an organization's own app.
- **Not yet served.** The automation service does not read the key yet. The connection door that takes the installer's client, and the form that asks for it, land in follow-up changes. Until then an instance that declares it on a non-MCP provider is held degraded, with a reason naming the missing `clientId`, and is never called without a client. On `provider: 'mcp'` over http the service runs the MCP authorization flow as it does for an instance that leaves its client to dynamic registration.

ADR-0143 D2.1 carries the amendment (2026-11-02).
