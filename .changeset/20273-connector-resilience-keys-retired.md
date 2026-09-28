---
'@objectstack/spec': minor
'@objectstack/connector-mcp': patch
'@objectstack/connector-openapi': patch
'@objectstack/connector-rest': patch
'@objectstack/connector-slack': patch
'@objectstack/service-automation': patch
---

feat(spec)!: retire the connector resilience family — `health` (health probe + circuit breaker), `status` and the nested `webhooks`, sixteen keys nothing read (#20273)

**BREAKING** — `connector.health` (the `healthCheck` probe, eight keys, and the
`circuitBreaker`, six keys), `connector.status` and the connector-nested
`webhooks` are removed from `ConnectorSchema` and `DeclarativeConnectorEntrySchema`
— so from `defineConnector`, `stack.connectors[]`, the `PUT /api/v1/meta/connector/:name`
door and `AutomationEngine.registerConnector`. ADR-0049 enforce-or-remove, one
batch for the family, by the maintainer's criterion: does the mainstream platform
offer this capability? Author-configured health probes and circuit breakers are
not connector metadata in the mainstream (breakers live in API-gateway
infrastructure), and an authored status and a nested webhook list duplicate what
is already delivered here by other keys.

Measured before removal, each against a lit control: zero reads of any of the
sixteen keys outside `packages/spec`. No loop ever polled a connector endpoint,
counted consecutive failures or tripped a breaker, and none of the four
`fallbackStrategy` behaviours existed. Nothing read an authored `status`: the
runtime's dispatchability answer is the COMPUTED `state` (`ready` / `degraded`)
on `GET /api/v1/automation/connectors`, which no authored value sets. A webhook
nested in a connector was never registered as a `webhook` item, so it was never
materialized into `sys_webhook` and never delivered.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `connector.health` (`healthCheck.*`, `circuitBreaker.*`, including `monitoringWindowMs` and the pre-rename `monitoringWindow`) | delete the block. Put health probes and circuit breaking in the connector provider or an upstream gateway. |
| `connector.status` | delete the key. `enabled: false` on a declarative entry is what withdraws a materialized instance or marks a catalog-only descriptor; whether a registered connector can be dispatched is the computed `state`. |
| `connector.webhooks` | delete the array. A webhook that is actually delivered is declared in the stack's top-level `webhooks:` collection — moving one there STARTS deliveries this connector never made, so decide per webhook. `events` and `signatureAlgorithm` have no counterpart there. |
| `ConnectorHealth`, `HealthCheckConfig`, `CircuitBreakerConfig`, `ConnectorStatus`, `WebhookConfig`, `WebhookEvent`, `WebhookSignatureAlgorithm` (schemas, types, `…Parsed` types) | no replacement — nothing parsed or constructed them. |

**The one-line fix: delete `health:`, `status:` and `webhooks:` from every connector.**
`os migrate meta --from 17` lists the mechanical edits for existing sources.

⚠️ Runtime behaviour is deliberately **unchanged**: none of the sixteen keys ever
changed what a connector did. What changes is the answer an author gets — each
key is refused at parse with a prescription, and in `tsc` (its input type is
`never`), instead of being saved with no effect.

### The retirement kit

- **Tombstones.** `health`, `status` and `webhooks` are `retiredKey()` tombstones
  on the private `ConnectorBaseSchema` both published carriers wrap (the schema
  is not `.strict()`, so a bare deletion would be a silent strip, ADR-0104).
  `RETIRED_KEYS_BY_MAJOR[18]`: `integration/Connector:{health,status,webhooks}`
  and `integration/DeclarativeConnectorEntry:{health,status,webhooks}`.
- **Retired-default residue.** `status` was `.default('inactive')`, so every 17.x
  parse emitted `status: 'inactive'` into every connector; that exact value joins
  `connectionTimeoutMs: 30000` in the residue stage (accepted and stripped, so a
  def a 17.x toolchain built still registers). Every other value is refused.
- **Seven defs leave whole** (`RETIRED_DEFS_BY_MAJOR[18]`): the four
  `integration/` schemas and three enums listed above.
- **D2 conversion `connector-resilience-keys-removed`** (step 18, retired from
  the load path): strips the three keys from `connectors[]` and from stored
  `sys_metadata` connector rows (the rehydration seam replays it), one notice per
  key, as a lossless delete. Nested webhooks are stripped, never moved.
- **The chain.** In the same step, `connector-health-and-trigger-durations-unit-in-key`
  renamed `health.circuitBreaker.monitoringWindow` to `monitoringWindowMs`. That
  breaker half is absorbed by this removal: the renamed key is itself removed, so
  an author holding either spelling ends with no `health` block. The
  conversion's `triggers[].interval` → `intervalSeconds` rename is unaffected.
- **D3 entry `connector-resilience-keys-retired`** carries the family's
  judgement: which probe, breaker or nested webhook the author actually relied
  on, and where it goes now.
- **Writers deleted.** The four shipped connector packages wrote
  `status: 'active'` and the automation service's degraded husk wrote
  `status: 'error'`; nothing read either back, and both writes are gone.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec`
is published, so this is breaking for consumers no telemetry was consulted for.

Clause-②: no (narrowing)

<!-- adr-0087: registered connector-resilience-keys-removed, connector-resilience-keys-retired -->
