# ADR-0024: MCP Servers as Connectors — Adopting an Open, Vendor-Neutral Tool Protocol

**Status**: Proposed (2026-06-01)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0011](./0011-actions-as-ai-tools.md) (actions as AI tools), [ADR-0015](./0015-external-datasource-federation.md) (open mechanism / enterprise lifecycle split), [ADR-0018](./0018-unified-node-action-registry.md) (`connector_action` baseline dispatch + connector registry), [ADR-0022](./0022-connectors-vs-messaging-channels.md) (Connector = transport/integration mechanism), [ADR-0023](./0023-openapi-to-connector-generator.md) (OpenAPI → Connector generator)
**Consumers**: `@objectstack/spec` (`integration/connector.zod.ts`), `@objectstack/service-automation` (connector registry on the engine), `@objectstack/runtime` (the `GET /api/v1/automation/connectors` discovery route), new `@objectstack/connector-mcp`, `@objectstack/service-ai` (the same MCP tools double as AI tools, ADR-0011), the Studio flow palette

---

## TL;DR

The question behind this ADR was "if we adopt an open connector spec (e.g. activepieces' pieces), can we use everyone's existing connectors as-is?" The finding: **pieces are engine-bound code, not a portable spec** — they cannot be dropped in (see [ADR-0023 §Context](./0023-openapi-to-connector-generator.md)). The genuinely open, vendor-neutral, *and growing* ecosystem of ready-to-use integrations is the **Model Context Protocol (MCP)**: a standard JSON-RPC interface where a server advertises `tools` (each with a `name`, `description`, and a JSON Schema `inputSchema`) and executes them via `tools/call`.

The shape of an MCP tool is **almost exactly our `ConnectorActionSchema`** (`key`, `label`, `description`, `inputSchema`, `outputSchema`). So instead of porting code, we **adapt at the registry boundary**: a generic adapter connects to an MCP server, lists its tools, maps each tool to a connector action, and dispatches `connector_action` calls to `tools/call`.

**Decision:** ship `@objectstack/connector-mcp` — an adapter that turns *any* MCP server into a `Connector` registered on the automation engine. One adapter unlocks the entire MCP ecosystem (filesystem, GitHub, Slack, databases, search, hundreds of community servers) with **no per-server code**, staying inside the ADR-0022 open mechanism / enterprise lifecycle split.

---

## Context

### Why MCP, after rejecting "import pieces"

| Property | activepieces piece | OpenAPI (ADR-0023) | **MCP server** |
|:---|:---|:---|:---|
| Portable / vendor-neutral | ❌ engine-bound TS | ✅ declarative | ✅ open protocol |
| Ready-to-run integrations exist today | ✅ (but unusable as-is) | ⚠️ only where a spec is published | ✅ a live, running server |
| Maps to our action shape | ❌ needs `ActionContext` | ✅ near-1:1 | ✅ near-1:1 (`inputSchema` is JSON Schema) |
| Execution model | their sandbox engine | our HTTP handler | the server's own process; we just call it |
| Auth | managed by their platform | static (open) | the server owns its credentials/config |

OpenAPI (ADR-0023) covers "the vendor published a REST spec." MCP covers the complementary and faster-growing case: **"someone already wrote and runs a working integration as an MCP server."** We don't re-implement it; we call it. The two ADRs are siblings — declarative-spec ingestion (0023) and live-server adoption (0024).

### MCP tool ≈ our connector action

An MCP `tools/list` entry:

```jsonc
{ "name": "create_issue",
  "description": "Create a GitHub issue",
  "inputSchema": { "type": "object", "properties": { "repo": {…}, "title": {…} }, "required": ["repo","title"] } }
```

Our `ConnectorActionSchema` (from [`connector.zod.ts`](../../packages/spec/src/integration/connector.zod.ts)):

```ts
{ key: string; label: string; description?: string;
  inputSchema?: JSONSchema; outputSchema?: JSONSchema }
```

The mapping is mechanical: `name → key`, `description → label/description`, `inputSchema → inputSchema`. MCP tool results map to the connector handler's return (`Record<string, unknown>`), normalised like the other connectors (`{ ok, content, … }`). This is why the integration is an **adapter, not a port**.

### This also feeds ADR-0011 (actions as AI tools)

Because MCP is *itself* a tool protocol designed for LLMs, every MCP tool we import is simultaneously a flow `connector_action` step **and** a candidate AI tool under ADR-0011 — one adapter, two consumers. (The reverse — exposing *our* actions as an MCP server — is a separate future ADR, noted under follow-ups.)

---

## Decision

### 1. A new open package: `@objectstack/connector-mcp`

Mirror the `connector-rest`/`connector-slack` conventions (Apache-2.0, `private: false`, peerDeps on `@objectstack/core` + `@objectstack/spec`, tsup build, a `create…Connector` factory + a `…Plugin`). It depends on the official MCP client SDK for transport.

```ts
// packages/connectors/connector-mcp/src/mcp-connector.ts
import type { Connector } from '@objectstack/spec/integration';

export interface McpConnectorOptions {
    /** Connector machine name (snake_case). Defaults to a slug of the server name. */
    name?: string;
    label?: string;
    /** How to reach the MCP server. */
    transport:
        | { kind: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
        | { kind: 'http'; url: string; headers?: Record<string, string> };
    /** Only expose tools whose name matches (allowlist) — keeps the palette lean. */
    include?: (toolName: string) => boolean;
}

/** A connector definition + handlers, ready for engine.registerConnector(). */
export interface McpConnectorBundle {
    def: Connector;
    handlers: Record<string, (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>>;
    /** Tear down the MCP client/connection (called by the plugin's stop()). */
    close(): Promise<void>;
}

export async function createMcpConnector(opts: McpConnectorOptions): Promise<McpConnectorBundle>;
```

It returns the same `{ def, handlers }` the registry already consumes (plus a `close()` for lifecycle), so registration goes through the existing `engine.registerConnector(def, handlers)` path with **no new engine surface**.

### 2. Discovery at connect time → static `Connector` after

On `start()`, the plugin connects to the MCP server, calls `tools/list`, and **builds the `Connector` definition once**. Each tool becomes an action; each handler closes over the tool name and calls `tools/call`. After that, the registry, the `connector_action` node ([connector-nodes.ts](../../packages/services/service-automation/src/builtin/connector-nodes.ts)), the discovery route (`GET /api/v1/automation/connectors`, served by [http-dispatcher.ts](../../packages/runtime/src/http-dispatcher.ts) via `getConnectorDescriptors()`), and the Studio palette all see an ordinary `type: 'api'` connector — they never know it is backed by MCP.

If the server is unreachable at boot, the plugin logs and skips (same posture as `ConnectorRestPlugin` when no automation engine is present) — a missing optional connector is not a fatal error.

### 3. Credentials and config live with the MCP server, not in our schema

An MCP server owns its own auth (e.g. a GitHub token passed via `env` on the stdio transport, or a bearer header on the HTTP transport). We pass through `env`/`headers` the operator supplies; we do **not** model the upstream's auth in `ConnectorSchema`. This keeps the connector contract unchanged and the secret handling at the process/transport boundary.

> **Secure handling:** transport `env`/`headers` carry credentials. They must come from environment variables / the settings store (ADR-0007), never be hardcoded in flow definitions or logged. The adapter passes them straight to the MCP client and keeps them out of the serialized `Connector` `def` (which is exposed via discovery).

### 4. Open-source / enterprise boundary (consistent with ADR-0015 / 0022 / 0023)

| Capability | Tier |
|:---|:---|
| MCP client adapter (stdio + http), `tools/list` → actions, `tools/call` dispatch, operator-supplied static credentials | **open** |
| A curated registry of vetted MCP servers, one-click install, managed secrets (`service-secrets`), per-tenant MCP connection lifecycle, sandboxed stdio execution | **enterprise** (per ADR-0015) |
| Marketplace / paid MCP server catalog | **enterprise** |

Running a community MCP server with an operator-provided token is open-source; *managing* those servers and their secrets at scale, multi-tenant, is the enterprise line — the identical split ADR-0022/0023 drew.

### 5. Anti-patterns this rules out

- ❌ **A new flow node for MCP.** MCP tools are dispatched through the existing `connector_action` node; no `mcp_call` node.
- ❌ **A parallel MCP-specific registry.** MCP-backed connectors register in the one connector registry like any other.
- ❌ **Forking `ConnectorSchema` for MCP.** Generated connectors are ordinary `type: 'api'` connectors; if a tool needs richer typing, that's a general schema discussion, not an MCP carve-out.
- ❌ **Per-server adapters.** One generic adapter; a specific server only ever warrants config (transport + `include`), never code.
- ❌ **Trusting arbitrary stdio servers in production unsandboxed.** Launching a stdio MCP server runs a local process; the safe-execution/sandbox story is explicitly enterprise (above), and the open tier should document the trust assumption.

---

## Consequences

**Positive**
- One adapter opens the entire, growing MCP ecosystem as flow connectors **and** AI tools (ADR-0011) — the closest thing to the "use everyone's connectors" goal that is actually technically sound.
- Zero per-integration code; new servers are pure configuration.
- MCP-backed connectors are indistinguishable from hand-written ones to the registry, discovery, palette, and AI layer.
- Complements ADR-0023: OpenAPI for published REST specs, MCP for live servers — together they cover most "I want this third-party integration" requests without bespoke code.

**Negative / costs**
- A new runtime dependency (the MCP client SDK) and a live connection lifecycle (connect, list, call, reconnect, close) — heavier than the pure-function REST/OpenAPI connectors.
- Tool schemas are only as good as the server provides; some omit `outputSchema` (we leave it unset, as the REST connector already does) and some under-specify inputs.
- stdio servers execute local processes — a real trust/sandbox concern that the open tier must flag and the enterprise tier must solve.
- MCP servers can change their tool list across versions; the connector is a snapshot taken at boot. A refresh/reconcile story is a follow-up.

---

## Status & follow-ups

- **This ADR changes no shipped code.** It records the decision to add an MCP adapter package on top of the existing connector baseline.
- Follow-up: scaffold `packages/connectors/connector-mcp` mirroring `connector-rest`, with `createMcpConnector` + `ConnectorMcpPlugin` (stdio + http transports).
- Follow-up: a worked example under `examples/` — e.g. the reference filesystem or GitHub MCP server → allowlisted actions invoked from a flow `connector_action` step.
- Follow-up: wire MCP-backed actions into the ADR-0011 AI-tool surface so they are usable as agent tools, not only flow steps.
- Future ADR (out of scope here): exposing **ObjectStack's own actions as an MCP server**, so external agents can call our platform — the inverse direction.
- Cross-reference: [ADR-0023](./0023-openapi-to-connector-generator.md) is the sibling path for declarative REST specs; this ADR is the path for live tool servers.
