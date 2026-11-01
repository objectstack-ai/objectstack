# Integration recipes — a declared connector per archetype

The rule is `SKILL.md` § Integrations are declared, not coded; this file is the
shapes. Each recipe is what the **app author** declares (a `connectors:` entry,
the fields the answer lands in, a flow dispatching `connector_action`) and the
one thing the **customer's administrator** supplies: the value behind
`auth.credentialRef` — an environment variable of that name (wins), or a
value set in the running app at `PUT /api/v1/automation/connectors/credential-refs/:ref`;
an unset ref leaves its instance degraded until set. A spec is not a
secret and ships in the package; an `api` flow's hook secret goes to the
deployment and to the sender. Keep `automation` in `requires` whenever a
connector is declared. Full guide: https://objectstack.ai/docs/automation/connectors.

## Holds on every recipe

- Actions come from the upstream (an OpenAPI `operationId`, an MCP tool name,
  the `rest` provider's single `request`) — authored on the entry, they are refused.
- `connectorConfig.input` is a value-slot map (SKILL.md's `connector_action`
  row): a top-level CEL envelope is evaluated, any other value kept as written,
  so a value from the record is a CEL envelope. The pre-dispatch `inputSchema`
  judgement honours OpenAPI `nullable`, reads `null` on an optional parameter
  as absent and names each breached path. Text is never converted: cast a
  string-held id, `path: { dialect: 'cel', source: '{"petId": int(record.vendor_id)}' }`.
- The answer lands as `<nodeId>.<key>` (`rest` / `openapi`: `{ status, ok, body }`;
  `mcp`: `{ ok, content, structuredContent? }`), read from a later node's value slot.
- `auth`, each variant with a `credentialRef`: `bearer`; `api-key` (`headerName`,
  or `paramName` for a query-string key); `basic` (`username`
  stays in metadata); `signed` on `openapi` / `rest` (`scheme`
  `aliyun-acs3-hmac-sha256`, `tencentcloud-tc3-hmac-sha256` or `alipay-v3`,
  `keyId`) signs each request — WeChat Pay has no scheme yet: blocked;
  `oauth2` / `app-credential`: recipe 6. A secret in a url path has no variant — use a
  token-authenticated connector. `authentication: { token }` is refused at `os validate`.
- `defineConnector`: `@objectstack/spec/integration`; `defineFlow`: `@objectstack/spec`; both register in `defineStack`.

## 1 · OpenAPI document, static key — Stripe balance, nightly

```ts
// Trim the vendor's OpenAPI 3.x document to the operations the app calls.
export const StripeConnector = defineConnector({
  name: 'stripe', label: 'Stripe', type: 'api', provider: 'openapi',
  providerConfig: { spec: './src/connectors/stripe.trimmed.json' },
  auth: { type: 'bearer', credentialRef: 'STRIPE_SECRET_KEY' },
});
// crm_account gains `stripe_available` (currency) and `stripe_synced_at` (datetime).
export const StripeBalanceSweep = defineFlow({
  name: 'stripe_balance_sweep', label: 'Stripe balance → house account',
  type: 'schedule', runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Nightly 03:00',
      config: { schedule: { type: 'cron', expression: '0 3 * * *' } } },
    { id: 'bal', type: 'connector_action', label: 'GET /v1/balance',
      connectorConfig: { connectorId: 'stripe', actionId: 'GetBalance', input: {} } },
    { id: 'write', type: 'update_record', label: 'Write balance', config: {
      objectName: 'crm_account', filter: { is_house_account: true },
      fields: { stripe_available: { dialect: 'cel', source: 'bal.body.available[0].amount / 100.0' },
                stripe_synced_at: { dialect: 'cel', source: 'isoDatetime(now())' } } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'bal' }, { id: 'e2', source: 'bal', target: 'write' },
          { id: 'e3', source: 'write', target: 'end' }],
});
```

`requires: ['automation', 'triggers', 'job']`. Convert Swagger 2.0 or YAML and
dereference every `$ref` offline, in-document ones included: the loader skips a
`$ref` parameter, request body or response and the derived schema silently
loses it. `providerConfig.include` allowlists operation keys as the
`mcp` provider's does (absent = every operation; a non-array or unknown entry is
fatal).

## 2 · Remote MCP server, static header — GitHub

```ts
export const GitHubMcp = defineConnector({
  name: 'github_mcp', label: 'GitHub (remote MCP)', type: 'api', provider: 'mcp',
  providerConfig: {
    transport: { kind: 'http', url: 'https://api.githubcopilot.com/mcp/',  // `stdio` needs the host's allowlist
                 headers: { 'X-MCP-Readonly': 'true' } },
    include: ['search_issues'],
  },
  auth: { type: 'bearer', credentialRef: 'GITHUB_MCP_TOKEN' },
});
// Weekly flow: connector_action { connectorId: 'github_mcp', actionId: 'search_issues',
//   input: { query: 'repo:acme/app is:open label:p0' } } → update_record on `eng_kpi`
//   fields: { open_p0: { dialect: 'cel', source: 'p0.content' } } (a `json` field).
```

`toolsSnapshot` pins each tool the app depends on: tool name → sha256 of its
`tools/list` definition; a pinned name `include` leaves out is refused at boot.
Digests: `computeMcpToolsSnapshot(tools)` (`@objectstack/connector-mcp`), or a
64-hex placeholder pin, then the served digest from the degraded reason. The
instance degrades with no actions; the `GET /api/v1/automation/connectors` reason
names each tool: a pinned tool served differently is `CONNECTOR_UPSTREAM_CHANGED`
with the digest it now serves (review, re-pin); one no longer listed is
the credential path when the instance's credential reached the server, as this
`bearer` does — the stored credential marked `rejected`: fix the credential and
set it again, or update the pin — and `CONNECTOR_UPSTREAM_CHANGED` otherwise. Rest:
https://objectstack.ai/docs/automation/connectors#pinning-tools-toolssnapshot.

## 3 · Plain REST API — `provider: 'rest'`, the one `request` action

```ts
export const WarehouseApi = defineConnector({
  name: 'warehouse_api', label: 'Warehouse API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://wms.example.com' },
  auth: { type: 'api-key', credentialRef: 'WMS_API_KEY', headerName: 'X-Api-Key' },
});
// connector_action { connectorId: 'warehouse_api', actionId: 'request',
//   input: { method: 'GET', path: '/v1/stock/low' } } → create_record `stock_alert`
//   fields: { lines: { dialect: 'cel', source: 'low.body' } }.
// To let an agent run the sweep on request: objectstack-ai § Actions as AI Tools.
```

## 4 · Vendor callback — an `api` flow with `secretRef`

```ts
export const CarrierCallback = defineFlow({
  name: 'carrier_callback', label: 'Carrier status callback', type: 'api',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'POST …/hooks/carrier_callback/carrier',
      config: { hookId: 'carrier', secretRef: 'CARRIER_HOOK_SECRET' } },
    { id: 'apply', type: 'update_record', label: 'Apply status', config: {
      objectName: 'shipment', filter: { tracking_no: { dialect: 'cel', source: 'record.tracking_no' } },
      fields: { status: { dialect: 'cel', source: 'record.status' } } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'apply' }, { id: 'e2', source: 'apply', target: 'end' }],
});
```

`requires: ['automation', 'triggers', 'queue']`. The sender signs each post
under `CARRIER_HOOK_SECRET` (SKILL.md *Signature* bullet). The door verifies no
other scheme: a vendor whose webhook signs its own header cannot post here
today — poll its status (recipe 1's shape) until vendor schemes verify.

## 5 · Vendor with no machine-readable spec — write the document by hand

```ts
export const LegacyErp = defineConnector({
  name: 'legacy_erp', label: 'Legacy ERP', type: 'api', provider: 'openapi',
  providerConfig: { spec: {
    openapi: '3.0.3', info: { title: 'Legacy ERP', version: '1' },
    servers: [{ url: 'https://erp.example.com' }],
    paths: { '/v2/open-orders': { get: { operationId: 'listOpenOrders',
             responses: { '200': { description: 'Open orders' } } } } },
  } },
  auth: { type: 'basic', username: 'svc_objectstack', credentialRef: 'ERP_SVC_PASSWORD' },
});
// connector_action { connectorId: 'legacy_erp', actionId: 'listOpenOrders', input: {} }
```

`provider: 'rest'` instead when the path is per call.

## 6 · OAuth or vendor-app token — the server runs the grant

Recipe 1's shape with a grant-bearing `auth`, served on `rest`, `openapi` and
`mcp` (`http` only; a `stdio` server's credentials ride `transport.env`): the
token is fetched per dispatch; no metadata key holds it.

```ts
// A user grants access once (PKCE always on); the ref is the client secret, omitted for a public client.
auth: { type: 'oauth2', grant: 'authorization_code', authorizationUrl: 'https://account.docusign.com/oauth/auth',
        tokenUrl: 'https://account.docusign.com/oauth/token', scopes: ['signature'],
        clientId: 'objectstack-prod', credentialRef: 'DOCUSIGN_CLIENT_SECRET' }
// Server to server: grant: 'client_credentials' with tokenUrl, clientId, credentialRef (`resource` optional).
// Vendor app id + app secret (`vendor`: `feishu` / `dingtalk` / `wecom`):
auth: { type: 'app-credential', vendor: 'feishu', appId: 'cli_a1b2', credentialRef: 'FEISHU_APP_SECRET' }
```

`client_credentials` and `app-credential` dispatch once the ref is set.
`authorization_code` is degraded "not connected" until an administrator holding
`manage_connector_connections` connects it, once per organization, from a
signed-in session (an agent or API key is refused):
`POST /api/v1/automation/connectors/:name/connection` answers `{ authorizationUrl }`;
the vendor redirects to `GET …/connectors/oauth/callback`. An `authorization_code`
instance on `mcp` may omit the `https://` endpoints and `clientId`, discovered at connect.
Still never park a short-lived token behind a `bearer` ref.
