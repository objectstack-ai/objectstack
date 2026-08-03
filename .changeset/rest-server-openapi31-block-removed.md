---
"@objectstack/spec": major
---

refactor(spec)!: remove the `RestServerConfig.openApi31` block — OpenAPI 3.1 webhooks/callbacks config that no runtime ever read (#4579, ADR-0049)

`RestServerConfig.openApi31` (typed by `OpenApi31ExtensionsSchema`, with
`OpenApiWebhookEventSchema` and `CallbackSchema` under it) was authorable and
inert end to end — the declared ≠ enforced shape ADR-0049 exists to close:

- The REST server's `normalizeConfig` (`packages/rest/src/rest-server.ts`)
  forwards only `api` / `crud` / `metadata` / `batch` / `routes`; `openApi31`
  was silently discarded.
- The served `GET /openapi.json` is the pre-generated `@objectstack/spec`
  contract, enriched at request time with the live server URL and the
  runtime-registered objects — it never consulted the config.
- `gen:openapi` (`scripts/build-openapi.ts`) never read a webhook or callback.

So a webhook an author declared under `openApi31.webhooks` **never appeared in
any served OpenAPI document** — false compliance, the same class as the
connector-webhook gap (#3197). Zero import-level consumers existed for all
three schemas across objectstack / cloud / objectui (three-repo scan in #4579).

Migration (FROM → TO):

- `openApi31` in a `RestServerConfig` value (REST plugin constructor /
  `plugin-hono-server` `restConfig`) → **delete the key**. There is no
  replacement: nothing ever read it, so removing it changes no served
  document. The key is tombstoned, not silently stripped —
  `RestServerConfigSchema` is not `.strict()`, so a `retiredKey()` tombstone
  makes authoring it a `tsc` error and a parse error carrying this
  prescription.
- `import { OpenApi31Extensions(Schema), Callback(Schema), OpenApiWebhookEvent(Schema) } from '@objectstack/spec/api'`
  → **no replacement export** (TS2305 after upgrade). For a real outbound
  webhook use `Webhook` from `@objectstack/spec/automation`; for connector
  webhook events use `WebhookEvent` from `@objectstack/spec/integration`.
  (`OpenApiWebhookEvent(Schema)` was the #4572 rename of `./api`'s
  `WebhookEvent(Schema)`; this removal absorbs that rename — pre-16 imports of
  the bare name land here too.)
- Config-driven OpenAPI 3.1 webhooks/callbacks documentation is a **new
  capability**: if it is ever needed it returns via the enforce route of
  ADR-0049, through a new ADR — not by re-declaring inert keys.

The retirement kit: `retiredKey()` tombstone on the non-strict schema (parse +
`tsc` both audible); ADR-0087 D3 semantic migration
`rest-server-openapi31-block-removed` (plugin TS config is never a
`sys_metadata` shape — the stack tree's `api` block declares only its four
scoping/auth knobs — so there is no stored row or stack source for a D2
conversion to rewrite); baselines (`authorable-surface.json` [RETIRED] line,
`json-schema.manifest.json` def removals, `api-surface.json`) regenerated
deliberately; compiler-API export pin + sabotage-verified tombstone tests.

No runtime behaviour changes — that impossibility is the reason for the
removal: the served `/openapi.json` is byte-identical before and after.
