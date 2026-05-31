# ADR-0023: OpenAPI → Connector Generator — Bulk Connectors From Declarative API Specs

**Status**: Proposed (2026-06-01)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0015](./0015-external-datasource-federation.md) (open mechanism / enterprise lifecycle split), [ADR-0018](./0018-unified-node-action-registry.md) (`connector_action` baseline dispatch + `engine.registerConnector()`), [ADR-0022](./0022-connectors-vs-messaging-channels.md) (Connector = transport/integration mechanism; not the messaging-semantic layer)
**Consumers**: `@objectstack/spec` (`integration/connector.zod.ts`), `@objectstack/service-automation` (connector registry on the engine), `@objectstack/runtime` (the `GET /api/v1/automation/connectors` discovery route), new `@objectstack/connector-openapi`, the Studio flow palette

---

## TL;DR

We want to populate the connector registry with *many* third-party APIs without hand-writing each one. The honest finding from surveying ecosystems like **activepieces** (697 community pieces, MIT) is that their integrations are **code bound to their engine** (`createAction({ run: (ctx) => … })` executed inside a V8/`isolated-vm` sandbox with an injected `ActionContext`) — they are not portable into our model, which is **a serializable `Connector` definition + plain `(input, ctx) => Promise<output>` handlers** registered in-process (ADR-0018/0022). You can *port the endpoint knowledge*, but you cannot *drop in* a piece.

The declarative substrate that **does** map cleanly onto our model is **OpenAPI** (and Arazzo for multi-step). An OpenAPI document is vendor-neutral, fully declarative, and already describes exactly what a `Connector` needs: a base URL, an auth scheme, and a set of operations with input/output JSON Schemas.

**Decision:** ship `@objectstack/connector-openapi` — a generator that turns an OpenAPI 3.x document into a `Connector` definition (one operation → one action) plus a single generic HTTP handler that executes any operation. It reuses the existing `connector-rest` request machinery; it adds **no new runtime abstraction** and stays inside the ADR-0022 open-source line (static auth only).

---

## Context

### Why not just import activepieces / n8n / Pipedream nodes?

| Their model | Our model |
|:---|:---|
| Integration = a TS class instance (`new IAction(...)`) + closures | Connector = serializable JSON (`ConnectorSchema`) + handler functions |
| `run(ctx)` receives a heavyweight `ActionContext` (auth, propsValue, store, files, connections, server callbacks, flow pause/resume) | `handler(input, ctx)` receives a plain `Record` and returns a plain `Record`; the registry lives on the engine ([engine.ts](../../packages/services/service-automation/src/engine.ts), `registerConnector`/`unregisterConnector`) |
| Executed by *their* engine inside a sandbox (`packages/server/engine`, `isolated-vm`) | Executed in-process by the `connector_action` node ([connector-nodes.ts](../../packages/services/service-automation/src/builtin/connector-nodes.ts)) |
| Dynamic props (server-side Dropdown), managed OAuth2 refresh | Static JSON Schema inputs; static auth (`none`/`api-key`/`basic`/`bearer`) open-source |

So a piece's `run()` cannot be called without their engine. What *is* reusable is the per-API knowledge (endpoints, params, error codes) — but that knowledge is far more cheaply harvested from a vendor's **OpenAPI spec** than reverse-engineered from a piece's closures. Many of the APIs those projects wrap publish OpenAPI documents directly.

### What a Connector needs vs. what OpenAPI provides

Our `Connector` (from [`connector.zod.ts`](../../packages/spec/src/integration/connector.zod.ts)) requires, at the open-source tier:

- `name`, `label`, `type: 'api'`, optional `icon`/`description`
- `authentication` — one of the static schemes
- `actions: { key, label, description?, inputSchema?, outputSchema? }[]` where the schemas are **JSON Schema**

OpenAPI 3.x supplies every one of these:

| Connector field | OpenAPI source |
|:---|:---|
| `label` / `description` | `info.title` / `info.description` |
| base URL | `servers[0].url` |
| `authentication` | `components.securitySchemes` (apiKey → `api-key`, http basic → `basic`, http bearer → `bearer`, none → `none`) |
| `actions[].key` | `operationId` (fallback: `${method} ${path}` slug) |
| `actions[].label` / `description` | `operation.summary` / `operation.description` |
| `actions[].inputSchema` | a JSON Schema assembled from `parameters` (path/query/header) + `requestBody` |
| `actions[].outputSchema` | the `200`/`2xx` `responses[*].content['application/json'].schema` |

The fit is near-1:1 because `ConnectorActionSchema.inputSchema/outputSchema` are already typed as free-form JSON Schema (`z.record(z.string(), z.unknown())`). No spec change is required.

### Why this is cheap

`@objectstack/connector-rest` already does the hard runtime part — build URL from base+path+query, apply static auth, JSON-encode the body, normalise the response to `{ status, ok, body }` ([rest-connector.ts](../../packages/connectors/connector-rest/src/rest-connector.ts)). The OpenAPI connector is therefore **mostly a definition generator** plus a thin handler that maps a generated action back to an HTTP call — and it can be built literally *on top of* a `createRestConnector(...)` instance.

---

## Decision

### 1. A new open package: `@objectstack/connector-openapi`

Mirror the `connector-rest` package conventions (Apache-2.0, `private: false`, peerDeps on `@objectstack/core` + `@objectstack/spec`, tsup build). It exports a pure generator and a plugin, exactly like the REST and Slack connectors.

```ts
// packages/connectors/connector-openapi/src/openapi-connector.ts
import type { Connector } from '@objectstack/spec/integration';
import type { RestConnectorBundle } from '@objectstack/connector-rest';

export interface OpenApiConnectorOptions {
    /** Connector machine name (snake_case). Defaults to a slug of info.title. */
    name?: string;
    /** The parsed OpenAPI 3.x document (caller loads/derefs it). */
    document: OpenApiDocument;
    /** Override the base URL (else servers[0].url). */
    baseUrl?: string;
    /** Static auth; if omitted, inferred from securitySchemes (best-effort) and
     *  credentials still supplied by the caller. */
    auth?: RestAuth;
    /** Only include operations whose operationId/tag matches (allowlist). */
    include?: (op: OperationInfo) => boolean;
    /** Injected for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
}

/** Returns a Connector definition + one handler per generated action. */
export function createOpenApiConnector(opts: OpenApiConnectorOptions): RestConnectorBundle;
```

It returns the **same `RestConnectorBundle` shape** (`{ def, handlers }`) that `engine.registerConnector(def, handlers)` already consumes — so the generator output is registered through the existing path with zero new engine surface.

### 2. One operation → one action; one generic handler

For each selected OpenAPI operation, emit a `ConnectorActionSchema` entry:

- `key` = `operationId` (deterministic slug fallback when missing)
- `inputSchema` = `{ type: 'object', properties: { path, query, header, body }, required: [...] }` assembled from the operation's parameters + requestBody
- `outputSchema` = the success response schema

The handler closes over the operation's `(method, pathTemplate)` and reuses the REST request logic: interpolate `path` params into the template, pass `query`/`header`/`body` straight through `createRestConnector`'s `request`. Concretely, the OpenAPI connector can be implemented **on top of** a `createRestConnector(...)` instance — one shared HTTP/auth implementation, per ADR-0022's "one transport" principle.

### 3. Generation is build-time-or-boot-time, never request-time

The generator runs when the plugin is constructed (boot) or offline via a CLI that writes a `*.connector.json`. The registry and the `connector_action` node see only a finished `Connector` — identical to a hand-written one. Discovery (`GET /api/v1/automation/connectors`, served by [http-dispatcher.ts](../../packages/runtime/src/http-dispatcher.ts) via the engine's `getConnectorDescriptors()`, [engine.ts](../../packages/services/service-automation/src/engine.ts)) and the Studio palette get the generated actions for free, with no awareness that they came from OpenAPI.

### 4. Open-source / enterprise boundary (consistent with ADR-0015 / 0022)

| Capability | Tier |
|:---|:---|
| OpenAPI 3.x → `Connector` generation, generic HTTP handler, static auth (`none`/`api-key`/`basic`/`bearer`) | **open** |
| CLI to pre-generate `*.connector.json` from a spec URL/file | **open** |
| Managed OAuth2 (authorize + token refresh), `service-secrets` credential vault, per-tenant connection lifecycle | **enterprise** (per ADR-0015) |
| Curated/marketplace connector catalog, paid premium specs | **enterprise** |

A spec that declares OAuth2 is still importable open-source — we generate the actions and let the caller inject a static bearer token; the *managed* OAuth refresh is the enterprise line, exactly as ADR-0022 drew it for Slack.

### 5. Anti-patterns this rules out

- ❌ **A bespoke importer per vendor.** If the vendor publishes OpenAPI, the generic generator covers it; don't hand-roll.
- ❌ **Runtime spec parsing inside the node.** The `connector_action` node stays a dumb dispatcher; all generation happens before registration.
- ❌ **Inventing a new connector sub-type.** Generated connectors are ordinary `type: 'api'` connectors; no schema fork.
- ❌ **Trying to auto-import activepieces/n8n nodes.** Those are engine-bound code; treat them as *reference material* for endpoints, not as importable artifacts.

---

## Consequences

**Positive**
- Hundreds of REST APIs become connectors from their published specs, with no per-API code and no new abstraction.
- Generated connectors are indistinguishable from hand-written ones to the registry, discovery endpoint, palette, and AI tooling.
- One HTTP/auth implementation (`connector-rest`) backs hand-written, Slack, and OpenAPI-generated connectors alike.

**Negative / costs**
- OpenAPI quality varies: missing `operationId`, untyped responses, `oneOf`/`allOf`, and `$ref` cycles need a deref+normalise pass. Mitigated by deterministic fallbacks and an `include` allowlist so a messy spec degrades to a usable subset rather than failing wholesale.
- Large specs generate large action lists; the `include` filter and tag-based selection keep the palette manageable.
- Non-REST / GraphQL / gRPC APIs are out of scope (OpenAPI only). Arazzo (multi-step workflows) is a future extension, not v1.

---

## Status & follow-ups

- **This ADR changes no shipped code.** It records the decision to add a generator package on top of the existing connector baseline.
- Follow-up: scaffold `packages/connectors/connector-openapi` mirroring `connector-rest`, with `createOpenApiConnector` + `ConnectorOpenApiPlugin`.
- Follow-up: a small `openapi-to-connector` CLI that emits a reviewable `*.connector.json`.
- Follow-up: a worked example (e.g. GitHub or Stripe public OpenAPI → a handful of allowlisted actions) under `examples/`, paralleling the worked `connector_action` example from ADR-0022.
- Cross-reference: see [ADR-0024](./0024-mcp-connectors.md) for the complementary path — wrapping live **MCP servers** as connectors when no OpenAPI spec exists but an MCP server does.
