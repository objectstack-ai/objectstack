# ADR-0096: Declarative Connector Instances — Provider-Bound `connectors:` Entries Materialized by Generic Executors

**Status**: Accepted (2026-07-15) — implemented in framework#2977
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0015](./0015-external-datasource-federation.md) (open mechanism / enterprise lifecycle split), [ADR-0018](./0018-unified-node-action-registry.md) (`connector_action` baseline dispatch + `engine.registerConnector()`), [ADR-0022](./0022-connectors-vs-messaging-channels.md) (Connector = transport/integration mechanism), [ADR-0023](./0023-openapi-to-connector-generator.md) (OpenAPI → Connector generator), [ADR-0024](./0024-mcp-connectors.md) (MCP servers as connectors)
**Tracking**: framework#2977 (supersedes the interim descriptor-only contract from framework#2612)
**Consumers**: `@objectstack/spec` (`stack.zod.ts`, `integration/connector.zod.ts`), `@objectstack/service-automation` (boot audit → provider binding), `@objectstack/connector-openapi`, `@objectstack/connector-mcp`, `@objectstack/connector-rest`, the Studio flow palette, AI authoring (stack generation)

---

## TL;DR

Declarative `connectors:` stack entries are **inert**: they register as metadata but never reach the automation engine's connector registry, which only plugins populate via `engine.registerConnector(def, handlers)` (#2612). The interim fix documented the collection as **descriptor-only** (catalog entries; boot audit warns on declared-with-actions-but-unregistered). This ADR specifies the upgrade: a declarative entry may name a **`provider`** — an installed generic executor (`openapi`, `mcp`, `rest`) — which **materializes** the entry into a live, dispatchable connector at boot. Declared-with-provider but no matching executor installed ⇒ **hard boot error** (upgrade of the audit warning). Credentials are **references** (`credentialRef`), never inline secrets.

Why this matters for the platform's mission: ObjectStack builds enterprise core business systems **with AI, out of metadata**. Enterprise core systems are integration-heavy by definition, and AI's native output is metadata, not plugin code. Every comparable platform ships this as table stakes — Salesforce External Services (OpenAPI spec → invocable Flow actions, zero code), Power Platform custom connectors (the connector *is* an OpenAPI document; per-environment "connections" carry the credentials), ServiceNow IntegrationHub spokes. A schema collection the AI can author but the runtime ignores is the worst failure mode a metadata platform can ship: plausible, validated, dead.

The runtime substrate already exists — ADR-0023/0024 deliver generic executors that turn declarative inputs (an OpenAPI document, an MCP endpoint) into `{ def, handlers }` bundles. This ADR adds only the **last mile**: stack metadata → executor factory → `registerConnector`.

---

## Context

### The two connector worlds (#2612)

1. **Runtime registry** (live): `engine.registerConnector(def, handlers)` requires a handler per action and backs `GET /connectors` + the `connector_action` node. Populated exclusively by plugins.
2. **Declarative `connectors:`** (inert): registered as metadata kind 'connector'; `ConnectorActionSchema` deliberately carries **no execution binding** (no method/path — ADR-0023 rejected re-inventing OpenAPI inside the stack schema), so a declared action *cannot* be interpreted into behavior.

The interim state (shipped with #2612's resolution): the contract is documented as descriptor-only, `enabled: false` marks deliberate catalog entries, and the automation service warns at boot about declared-with-actions entries lacking a same-name runtime registration.

### Why naive bridging was rejected

Matching declared entries to already-installed plugin connectors **by name** adds nothing (the plugin registers itself) and creates a two-sources-of-truth hazard: the declared def and the plugin def of the same connector can drift. Any real bridge must make the declarative entry the **configuration** and the executor the **behavior** — type/instance separation, exactly the datasource pattern (declared in stack, adapter in code).

---

## Decision

### 1. `provider` on the stack-level connector entry

A declarative connector entry MAY carry a `provider` plus provider-specific config:

```ts
connectors: [{
  name: 'billing',
  label: 'Billing API',
  type: 'api',
  provider: 'openapi',                        // ← which installed executor materializes this
  providerConfig: {                           //   provider-specific; validated by the provider
    spec: './specs/billing-openapi.json',     //   openapi: document ref
    baseUrl: 'https://billing.example.com',
  },
  auth: { type: 'bearer', credentialRef: 'billing_api_token' },  // reference, never a secret
}]
```

- **No `provider`** → the entry is a catalog descriptor, exactly the #2612 interim contract (audit warning applies unless `enabled: false`).
- **`provider` present** → the entry is an **instance declaration** and MUST be materialized at boot.

### 2. Providers are factories contributed by connector plugins

A connector plugin (e.g. `@objectstack/connector-openapi`) registers a **provider factory** under its provider key at `init()`. At `kernel:ready`, the automation service resolves each instance declaration:

1. Look up the factory for `entry.provider`.
2. Factory validates `providerConfig`, resolves `credentialRef` via the secrets layer, and returns the same `{ def, handlers }` bundle the generator APIs already produce (ADR-0023 §1).
3. The service calls `engine.registerConnector(def, handlers)` — the registry and `connector_action` see a finished connector, indistinguishable from a hand-written one.

**Declared `provider` with no installed factory ⇒ boot fails loudly** (validation error naming the entry, the provider, and the plugin that supplies it). This upgrades the #2612 audit from warning to error, but **only** for provider-bound entries — plain descriptors keep the warning-or-`enabled:false` contract.

### 3. Credentials are references

`credentialRef` resolves through the secrets service at materialization time. Inline secrets in stack metadata are rejected at authoring/publish (lint + schema). Per the ADR-0015 line: static credentials resolved from env/config are **open**; managed vaulting, OAuth2 refresh, and per-tenant connection lifecycle are **enterprise**.

### 4. Two-sources-of-truth rule

If a provider-bound instance and a plugin-registered connector share a `name`, boot fails with a naming-conflict error — there is no precedence, because silent precedence is how drift hides. (Plain descriptors sharing a live connector's name stay legal: the descriptor is catalog metadata *about* the live connector.)

### 5. Non-goals

- **No execution bindings inside `ConnectorActionSchema`.** Actions on an instance declaration are *derived by the provider* (from the OpenAPI document / MCP `tools/list`), not authored. Authoring both the instance and its actions would reintroduce drift.
- **L3 aspirational surfaces stay out of scope**: `syncConfig`, `fieldMappings`, `webhooks`, `triggers` on `ConnectorSchema` remain unimplemented by this ADR.
- **No messaging semantics** — the ADR-0022 layering stands; this is transport only.

### 6. Acceptance

- An AI-generated app declares a connector instance (e.g. `provider: 'mcp'` pointing at an MCP server) as pure metadata; a flow `connector_action` dispatches one of its actions end-to-end.
- The showcase demonstrates the declarative path live (upgrading the catalog-descriptor demo shipped with #2612) and `GET /connectors` lists the materialized instance.
- Boot fails loudly for: unknown provider, invalid providerConfig, unresolvable credentialRef, name conflict with a plugin-registered connector.

---

## Consequences

**Positive**
- The `connectors:` collection stops being the platform's one dead metadata surface; AI can wire integrations without leaving metadata.
- Zero new runtime abstraction: providers reuse the ADR-0023/0024 generator/adapter APIs verbatim.
- The industry-standard definition/credential split (Salesforce Named Credentials, Power Platform connections) lands with the schema, not as a retrofit.

**Negative / costs**
- Schema evolution on a shipped collection (`provider`, `providerConfig`, `credentialRef`) — additive, so no migration, but the descriptor-only docs shipped with #2612 must be revised when this lands.
- The secrets-layer dependency makes credential resolution a boot-path concern; environments without a secrets service need a clear degraded story (env-var fallback, open tier).
- Provider factories add a registration surface to connector plugins (small; mirrors how they already self-register).

---

## Implementation (framework#2977)

| Decision | Where it landed |
|:---|:---|
| 1. `provider` / `providerConfig` / `auth` on the entry | `@objectstack/spec` — `integration/connector.zod.ts` (`ConnectorSchema` gains the three fields; `authentication` now defaults to `{ type: 'none' }`); `shared/connector-auth.zod.ts` (`ConnectorInstanceAuthSchema` — the `credentialRef` shapes; `ResolvedConnectorAuth`). Authoring rules (`DeclarativeConnectorEntrySchema`, used by `stack.zod.ts`) reject inline secrets, orphan `providerConfig`/`auth`, and authored `actions`/`triggers` on a provider-bound entry (§5). |
| 2. Provider factory registry | `@objectstack/spec` — `integration/connector-provider.ts` (`ConnectorProviderFactory` / `ConnectorProviderContext` / `ConnectorMaterialization`, pure types so plugins depend only on the spec). The engine adds `registerConnectorProvider` / `getConnectorProvider` (`service-automation/src/engine.ts`). |
| 3. Boot materialization + `credentialRef` | `service-automation/src/plugin.ts` — `materializeDeclaredConnectors()` runs in `start()` (a throw there is fatal to bootstrap under both `LiteKernel` and `ObjectKernel`, unlike a swallowed `kernel:ready` hook). `credentialRef` resolves via a `CredentialResolver`; the open-tier default reads env vars. |
| 4. Conflict rule | `registerConnector` is origin-tagged (`plugin` vs `declarative`); a cross-origin name collision throws instead of silently replacing. |
| 5. Provider implementations | `connector-rest` (`rest`), `connector-openapi` (`openapi`), `connector-mcp` (`mcp`) each export a `create*ProviderFactory` and register it in the plugin's `init()`. The plugins now take **optional** options: with none they contribute only the provider factory; with instance options they also register a hand-wired connector (back-compat). |
| 6. Showcase | `examples/app-showcase` — `StatusApiConnector` (`provider: 'rest'`) is materialized at boot and dispatched by `ShowcaseDeclarativeConnectorPingFlow`; `coverage.ts` records it. |

### Open / enterprise line (ADR-0015)

- **Open source:** the `rest` / `openapi` / `mcp` provider factories; **static** auth (`none` / `api-key` / `basic` / `bearer`); `credentialRef` resolved from **environment variables** (`defaultEnvCredentialResolver`) — the degraded-but-honest story for environments with no managed secrets service.
- **Enterprise:** managed credential **vaulting** and OAuth2 authorization-code/refresh lifecycle (inject a vault-backed `CredentialResolver` via `AutomationServicePluginOptions.credentialResolver` — no change to the materialization path), plus per-tenant connection lifecycle. The open tier deliberately omits OAuth2 from `ConnectorInstanceAuthSchema`.

### Deliberate scope boundaries

- **Boot-time only.** Materialization runs once at boot. Re-materializing a provider-bound instance published at runtime (Studio) is a follow-up; the descriptor audit still re-runs on `metadata:reloaded`.
- **`providerConfig.spec` (openapi)** accepts an inline document or an http(s) URL; resolving a `./file.json` ref relative to the stack is the stack loader's job, not the connector's.
- **MCP credentials** ride the transport (ADR-0024); for an http transport a resolved `auth` is folded into the request headers.
