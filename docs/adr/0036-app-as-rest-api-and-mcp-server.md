# ADR-0036: Every app is a REST API + an MCP server — make it visible and connectable after build

**Status**: Proposed (2026-06-06)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0011](./0011-actions-as-ai-tools.md) (actions/objects as AI tools), [ADR-0024](./0024-mcp-connectors.md) (MCP as connectors — the *inbound* sibling: ObjectStack **consuming** external MCP servers; this ADR is the *outbound* direction), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (AI builds the metadata; publishing makes it live)
**Consumers**: `@objectstack/rest` (REST CRUD + `/api/v1/discovery`), new HTTP transport in `@objectstack/plugin-mcp-server`, `@objectstack/platform-objects` (`sys_api_key`), `../objectui` (Developer Hub → new Integrations page; publish surface), `../cloud` (per-env public hostname = the API/MCP base)

**Premise**: pre-launch, no back-compat debt — specify the target end-state directly.

**Design center**: **the moment you build an object in ObjectStack, it is already a programmable REST API and an agent-ready MCP toolset — we just have to make that visible and one-click connectable.** This is the differentiator Lovable / Airtable / Power Apps structurally cannot match: their output is a screen; ours is a *governed data backend* that any program or AI agent can drive. The magic moment (one sentence → a working, populated app) should end not at "here's your screen" but at **"here's your screen — and here's the API + the agent tools it exposes."**

---

## TL;DR

A metadata-driven ObjectStack app **already** auto-generates a full REST CRUD API (`/api/v1/data/{object}`) discoverable at `/api/v1/discovery`, and the `plugin-mcp-server` **already** maps every object's CRUD (and the registered AI tools) to MCP tools. Two things are missing to turn that latent capability into a product: (1) the MCP server only speaks **stdio**, so a remote agent (Claude Desktop / Cursor) can't connect to a cloud env; (2) none of it is **surfaced** — a user who just built an app has no idea it's an API, no self-serve key, no connect button.

**Decision.** Treat "expose this app as an API + MCP server" as a first-class, open framework capability and surface it right after build:

1. **REST**: keep the auto-generated CRUD + discovery (no change); **surface** it (base URL, per-object endpoints, sample code, the existing API Console).
2. **Auth**: per-env, self-serve **API keys** (`sys_api_key`, modelled but **not yet enforced** — wiring the key Bearer into the auth path is Phase 1a) — Bearer tokens that resolve to a principal and run under the key's existing permissions + RLS; a show-once generation UX.
3. **MCP**: add an **HTTP transport** to `plugin-mcp-server` (a stable `/api/v1/mcp` endpoint, authed by the same Bearer), and **generate the Claude/Cursor connection config** for the env.
4. **Surface**: a Developer-Hub **Integrations & APIs** page + a "View API / Connect an agent" affordance on publish success.

**Open-core boundary**: the REST serve path, the MCP HTTP transport, discovery, and `sys_api_key` are the **open mechanism** (framework); the AI/intelligence that *authored* the app stays closed; the surfacing UI lives in objectui.

---

## Context

### What already exists (verified)

| Capability | Where | Status |
|---|---|---|
| REST CRUD per object (`/api/v1/data/{object}` + OData query) | `@objectstack/rest` `registerCrudEndpoints()` | ✅ auto-generated on publish |
| API discovery (`/api/v1/discovery`) | `@objectstack/rest` | ✅ |
| API Console (interactive REST debugger) | objectui `apps/console/.../developer/ApiConsolePage` | ✅ shipped |
| MCP server: object CRUD + AI tools → MCP tools | `@objectstack/plugin-mcp-server` | ✅ but **stdio only**, default off |
| Per-user/env API keys (create/revoke, key returned once) | `platform-objects/.../sys-api-key.object.ts` | ⚠️ **model only — NOT enforced for auth** (no key-verification path; the data API accepts only the better-auth session); no UI |
| Per-env public hostname (`<env>.objectos.app`) = API/MCP base | cloud env registry | ✅ |

### What is missing

1. **MCP HTTP transport** — stdio works for a local CLI; a hosted env needs an HTTP endpoint (streamable-http / SSE) so external agents can connect over the network.
2. **External auth wiring** — the REST/MCP surface must accept a `sys_api_key` Bearer and enforce that key's scopes/permissions (RLS still applies).
3. **Surfacing** — the whole capability is invisible: no base-URL display, no self-serve key, no connect-an-agent flow, no post-publish nudge.

### Why this is the differentiator

Lovable/Airtable/Power Apps produce a UI bound to their runtime. ObjectStack produces a **governed backend**: typed objects, validations, permissions, RLS — and the *same* metadata that renders the screen also defines the API and the agent tools. Surfacing "your app is an API + MCP server" converts our architectural fact into a felt advantage, and it is the natural on-ramp to programmatic + agentic use (and, later, paid tiers).

---

## Decision detail

### 1. REST — surface, don't rebuild
No runtime change. A new **Integrations & APIs** page reads `/api/v1/discovery` + `/api/v1/meta/object`, shows the env **Base URL** (`window.location.origin`), lists each published object's endpoints (`GET/POST /data/{object}`, `GET/PATCH/DELETE /data/{object}/:id`), links to the existing API Console, and renders copy-paste **cURL / JS / Python** samples using the user's key.

### 2. Auth — self-serve API keys (hand-rolled verification)

> **Correction (verified 2026-06-06).** The pinned **better-auth 1.6.13 has NO
> `apiKey` plugin** (its `dist/plugins` ships access, admin, anonymous, bearer,
> captcha, jwt, magic-link, **mcp**, oidc-provider, organization, two-factor,
> username, … but *not* api-key). So "just enable the plugin" is not an option
> on this version. (Note for Phase 2: better-auth 1.6.13 **does** ship an `mcp`
> plugin — `mcp()` + `withMcpAuth` + OAuth discovery — which Phase 2 can use.)

**Mechanism (revised):** **hand-roll** the API-key check as a small, isolated
auth step in the runtime request pipeline (where the session principal is
resolved today): if `Authorization: Bearer <key>` is present and matches a
`sys_api_key` (constant-time hash compare; not revoked; not expired), resolve it
to its `user_id` and establish **the same principal context the session path
produces** — then the existing object permissions + RLS apply unchanged (no
parallel auth, no escalation). Reuse the platform's hashing util; store only the
hash (the model already does). `last_used_at` bumped on use.

This is the **most security-sensitive change in this ADR** — hand-rolled auth.
It MUST be its own focused, fully-tested change (see the Security note below),
not bundled. Alternative (rejected for now): bump better-auth to a version that
ships `apiKey` — a global auth-surface version bump is higher blast-radius than a
small, well-tested key-verification step.

- UI "Generate API key" → `POST /api/v1/data/sys_api_key`; the raw key is
  returned **once**, shown in a copy-once panel, prefix-only thereafter.
- Keys are **per environment**; revoke/restore + expiry already on the object.

> **Security note**: this is a deliberate, security-sensitive change — it opens
> the tenant data backend to non-browser callers. It must be implemented as a
> focused, well-tested piece (key-create → keyed request → resolves to principal
> → object permissions + RLS enforced → revoked/expired key rejected), not
> bundled into unrelated work.

### 3. MCP — add HTTP transport (Phase 2)
- Extend `plugin-mcp-server` with a **streamable-http** (with SSE fallback) transport mounted at a stable route (`/api/v1/mcp`), gated by `OS_MCP_SERVER_ENABLED` per env (explicit opt-in — exposing tools is a deliberate act).
- Auth: the same `sys_api_key` Bearer; the advertised `tools` are the env's object CRUD + any AI tools the key is scoped for.
- The Integrations page **generates the connection config** (Claude Desktop `claude_desktop_config.json` / Cursor snippet) with the env's MCP URL + a generated key, and a one-click copy/download.

### 4. Surface points (objectui)
- **Developer Hub**: add an **Integrations & APIs** card → the new page.
- **Publish success**: the Publish & Open flow (ADR-0033 / the chat publish CTA) gains a secondary "View API · Connect an agent" link, so the API/MCP surface is discovered at the moment of "it works".

### 5. Phasing

> **Correction (verified 2026-06-06).** `sys_api_key` is **modelled but NOT enforced for auth** — the REST/data API today accepts only the better-auth session (cookie, or "Bearer = session token"); there is no key-verification path. The API Console "works" only because it runs inside the logged-in console (session cookie). So external programmatic access — the whole point — does **not** work yet. Wiring `sys_api_key` Bearer into the auth layer is therefore the **foundation of Phase 1**, not a pre-existing capability. Phase 1 is *not* objectui-only.

- **Phase 1a (framework — the foundation)**: authenticate `Authorization: Bearer <sys_api_key>` on the runtime auth path — verify the key (hash match, not revoked, not expired), resolve it to its principal, and run the request **as that principal under the existing permissions + RLS** (reuse the auth/permission layer; never a parallel one, never an escalation). This is what makes "your app is an external API" actually true. Unit-tested locally.
- **Phase 1b (objectui — surfacing)**: Integrations & APIs page (base URL + per-object endpoints + API Console link + **self-serve API-key generation, show-once** + cURL/JS samples) + Developer-Hub card + publish-success "View API" link. Locally testable against the keyed auth path.
- **Phase 2 (framework + objectui)**: MCP **Streamable HTTP** transport (single `/api/v1/mcp`, same Bearer auth), per-env opt-in (`OS_MCP_SERVER_ENABLED`), + connection-config generator and "Connect to Claude/Cursor" button. (Streamable HTTP, not the deprecated HTTP+SSE — single endpoint fits the Worker→container path; confirm streaming pass-through.)

---

## Alternatives considered

- **stdio-only MCP** (status quo): fine for a local CLI, useless for a hosted env an external agent must reach over the network. Rejected for the cloud surface.
- **No auth / public read API**: a tenant data backend must never be open; the key + RLS model is mandatory.
- **A separate API-gateway product**: unnecessary — the runtime already serves the REST API and (with Phase 2) the MCP endpoint from the same env host. Adding a gateway would split the security model.
- **Auto-enable MCP for every env**: rejected — exposing tools to external agents is a deliberate, opt-in act (`OS_MCP_SERVER_ENABLED`), surfaced as an explicit "Enable" in the Integrations page.

---

## Consequences

- **Positive**: the magic moment ends on a programmable, agent-ready backend; a clean on-ramp to programmatic + agentic use and to paid tiers; no new runtime for REST (pure surfacing in Phase 1).
- **Cost**: Phase 2's MCP HTTP transport + per-key auth is real framework work (transport, session, Bearer enforcement); the API-key show-once UX needs care (never re-display the raw key).
- **Security**: every external entry runs as a scoped `sys_api_key` principal under existing object permissions + RLS; MCP is opt-in per env; keys are revocable.

## Status / next
Phase 1 (Integrations page + API-key UX + publish-success link) is implementable now against shipped endpoints. Phase 2 (MCP HTTP transport) follows as a framework change with its own tests.
