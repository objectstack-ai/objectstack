# Integration recipes — a declared connector per archetype

The rule is `SKILL.md` § Integrations are declared, not coded; this file is the
shapes. Each recipe is what the **app author** declares (a `connectors:` entry,
the fields the answer lands in, a flow dispatching `connector_action`) and the
one thing the **customer's administrator** supplies: the value behind
`auth.credentialRef` — an environment variable of that name (wins), or a
value set in the running app at `PUT /api/v1/automation/connectors/credential-refs/:ref`;
an unset ref leaves its instance degraded until set. A spec is not a
secret and ships in the package; an `api` flow's hook secret goes to the
deployment and to the sender. Scaffolded apps list the three executors in
`plugins:`; keep `automation` in `requires` whenever a connector is declared. Full guide: https://objectstack.ai/docs/automation/connectors.

## Holds on every recipe

- Actions come from the upstream (an OpenAPI `operationId`, an MCP tool name,
  the `rest` provider's single `request`) — authored on the entry, they are refused.
- `connectorConfig.input` is a value-slot map like `subflow` `input`: a top-level
  CEL envelope is evaluated, any other value kept as written. `registerFlow` and
  `os validate` refuse a `{…}` token at `connectorConfig.input.<key>`: a value
  from the record is a CEL envelope. Before dispatch the result is judged
  against the action's `inputSchema`: `required`, `type` (with OpenAPI
  `nullable`), `properties`, `items`; `null` on an optional parameter is
  absent. A breach fails the step `VALIDATION_ERROR` (`fault`-routable) naming
  each path, nothing sent. Text is never converted: cast a string-held id,
  `path: { dialect: 'cel', source: '{"petId": int(record.vendor_id)}' }`.
  `os validate` does not judge the `inputSchema` fit yet.
- The answer lands as `<nodeId>.<key>` (`rest` / `openapi`: `{ status, ok, body }`;
  `mcp`: `{ ok, content, structuredContent? }`), read from a later node's value slot.
- `auth`, each variant with a `credentialRef`: `bearer`; `api-key` (`headerName`,
  default `X-API-Key`, or `paramName` for a query-string key); `basic` (`username`
  stays in metadata). A secret in a url path has no variant — use a
  token-authenticated connector. `authentication: { token }` is refused at `os validate`.
- `defineConnector`: `@objectstack/spec/integration`; `defineFlow`: `@objectstack/spec`; both register in `defineStack`.

## 1 · OpenAPI document, static key — Stripe balance, nightly

```ts
// Trim the vendor's OpenAPI 3.x document to the operations the app calls; its path
// is package-relative.
export const StripeConnector = defineConnector({
  name: 'stripe', label: 'Stripe', type: 'api', provider: 'openapi',
  providerConfig: { spec: './src/connectors/stripe.trimmed.json' },
  auth: { type: 'bearer', credentialRef: 'STRIPE_SECRET_KEY' },
});
// crm_account gains `stripe_available` (currency) and `stripe_synced_at` (datetime).
export const StripeBalanceSweep = defineFlow({
  name: 'stripe_balance_sweep', label: 'Stripe balance → house account',
  type: 'schedule', runAs: 'system',          // a scheduled run has no trigger user
  nodes: [
    { id: 'start', type: 'start', label: 'Nightly 03:00',
      config: { schedule: { type: 'cron', expression: '0 3 * * *' } } },
    { id: 'bal', type: 'connector_action', label: 'GET /v1/balance',
      connectorConfig: { connectorId: 'stripe', actionId: 'GetBalance', input: {} } },
    { id: 'write', type: 'update_record', label: 'Write balance', config: {
      objectName: 'crm_account', filter: { is_house_account: true }, // multi-tenant: pin the organization too
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
`$ref` parameter, request body or response, and the derived input/output schema
silently loses it. `providerConfig.include` allowlists operation keys as the
`mcp` provider's does (absent = every operation; a non-array or unknown entry is
fatal).

## 2 · Remote MCP server, static header — GitHub

```ts
export const GitHubMcp = defineConnector({
  name: 'github_mcp', label: 'GitHub (remote MCP)', type: 'api', provider: 'mcp',
  providerConfig: {
    transport: { kind: 'http', url: 'https://api.githubcopilot.com/mcp/',  // `stdio` spawns a local process:
                 headers: { 'X-MCP-Readonly': 'true' } },   // denied unless the host allowlists the command
    include: ['search_issues'],                             // tool-name allowlist → the actions
  },
  auth: { type: 'bearer', credentialRef: 'GITHUB_MCP_TOKEN' }, // folded into the request headers
});
// Weekly flow: connector_action { connectorId: 'github_mcp', actionId: 'search_issues',
//   input: { query: 'repo:acme/app is:open label:p0' } } → update_record on `eng_kpi`
//   fields: { open_p0: { dialect: 'cel', source: 'p0.content' } } (a `json` field).
```

## 3 · Plain REST API — `provider: 'rest'`, the one `request` action

```ts
export const WarehouseApi = defineConnector({
  name: 'warehouse_api', label: 'Warehouse API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://wms.example.com', defaultHeaders: { Accept: 'application/json' } },
  auth: { type: 'api-key', credentialRef: 'WMS_API_KEY', headerName: 'X-Api-Key' },
});
// connector_action { connectorId: 'warehouse_api', actionId: 'request',
//   input: { method: 'GET', path: '/v1/stock/low' } } → create_record `stock_alert`
//   fields: { lines: { dialect: 'cel', source: 'low.body' } }.
// Optional — let an agent run the sweep on request (objectstack-ai § Actions as AI Tools):
// { name: 'refresh_low_stock', label: 'Refresh low stock', type: 'flow', target: 'low_stock_sweep',
//   ai: { exposed: true, description: 'Pull the current low-stock lines from the warehouse API into stock_alert rows.' } }
```

## 4 · Vendor callback — an `api` flow with `secretRef`

```ts
export const CarrierCallback = defineFlow({
  name: 'carrier_callback', label: 'Carrier status callback', type: 'api',
  runAs: 'system',  // no trigger user
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
`x-objectstack-signature: t=<unix>,v1=<hex>` — HMAC-SHA256 of `<t>.<raw body>`
under `CARRIER_HOOK_SECRET`. The door has no unsigned form and verifies no other
scheme, so a vendor whose webhook signs its own header cannot post here today:
name the gap and poll its status (recipe 1's shape) until vendor schemes verify.

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

Each `operationId` is a named action in the flow palette and to agents;
`provider: 'rest'` instead when the path is per call.

## Not yet — declare the rest, mark the integration blocked, write no plugin

- **OAuth-protected vendor** (DocuSign, Salesforce, Google): the declarative `auth`
  union has no `oauth2`; the authorization-code / refresh
  lifecycle is not delivered in the open tier. Do not park a short-lived access
  token behind a `bearer` ref. Blocked on the platform's outbound-OAuth card.
- **Signature-authenticated vendor** (Alipay, WeChat Pay, Aliyun — RSA2 / HMAC
  canonical-request signing): no auth kind signs requests today; blocked on the request-signing card.
