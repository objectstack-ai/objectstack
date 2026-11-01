# ADR-0097: Declarative Connector Instances — Provider-Bound `connectors:` Entries Materialized by Generic Executors

**Status**: Accepted (2026-07-15) — implemented in framework#2977
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0015](./0015-external-datasource-federation.md) (open mechanism / enterprise lifecycle split), [ADR-0018](./0018-unified-node-action-registry.md) (`connector_action` baseline dispatch + `engine.registerConnector()`), [ADR-0022](./0022-connectors-vs-messaging-channels.md) (Connector = transport/integration mechanism), [ADR-0023](./0023-openapi-to-connector-generator.md) (OpenAPI → Connector generator), [ADR-0024](./0024-mcp-connectors.md) (MCP servers as connectors)
**Tracking**: framework#2977 (supersedes the interim descriptor-only contract from framework#2612)
**Consumers**: `@objectstack/spec` (`stack.zod.ts`, `integration/connector.zod.ts`), `@objectstack/service-automation` (boot audit → provider binding), `@objectstack/connector-openapi`, `@objectstack/connector-mcp`, `@objectstack/connector-rest`, the Studio flow palette, AI authoring (stack generation)
**Amended by**: [ADR-0143](./0143-outbound-connector-auth-is-open-tier.md) (2026-10-27) — OAuth2, the vendor app-credential exchange and request signing join `ConnectorInstanceAuthSchema` in the open tier, and those kinds resolve per dispatch; see the notes under §3 and under "Open / enterprise line". PR #26798 (2026-10-27, #26709 item 3(b)) — a credential the MCP server rejects (HTTP `401` / `403`) is a fatal configuration fault, not upstream-unavailable; see the note under "Upstream availability". #27237 (2026-10-28, ruling A on #27230 and the ruling on #27237) — an unresolved `credentialRef` and a rejected credential degrade the instance instead of failing the boot (a refused stored credential holds its instance until it is set again or a restart; an environment or vault one is retried on the backoff), and the open tier reads a `sys_connector_credential` store between the environment and the host's resolver, except under a walled tenancy posture; see the notes under §6 and under "Upstream availability". #28038 (2026-10-30, after #27992 / PR #28014 and #28016 / PR #28037) — a held degraded instance (a configuration fault met on a retry, or a refused stored or declared credential) is not retried, and its dispatch refusal names the edit or the credential that unblocks it; "the platform retries automatically" stays for an instance on the backoff; see the note under "Upstream availability". #27429 (2026-10-31, after #27237) — on a reload too, an unresolved `credentialRef` degrades its instance instead of being skipped, and a credential that is no longer set takes the live connector down; see the note under "Runtime reconcile".

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

> **Amendment note (2026-10-27, ADR-0143).** OAuth2 refresh and the per-connection lifecycle are
> open tier now. The vaulting **backend** keeps this placement. `credentialRef` stays the only
> way an author names a secret, and inline secrets stay refused at publish. What changes is *when*
> resolution happens, for the new grant-bearing kinds only: `oauth2` and `app-credential` resolve a
> live token per dispatch, refreshing on expiry and once on a `401`, and `signed` resolves its
> signer per dispatch. Their tokens live in a connection record, never in metadata. The four static
> kinds still resolve once, at materialization.

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

> **Amendment note (2026-10-28, #27237 — ruling A on #27230, comment 6468327468).** An
> unresolvable `credentialRef` leaves this list. An administrator installs an app first and fills
> its credentials after, so a reference no source answers for degrades the instance naming it (a
> husk on `GET /connectors` whose reason names the reference), and the instance materializes,
> without a restart, once the credential is set. The open-tier sources are, in order: an
> environment variable of the same name, the `sys_connector_credential` store (a `Field.secret`
> row written through `PUT /api/v1/automation/connectors/credential-refs/:ref`), then the host's
> injected resolver. Environment-level only (S1 on #27230): under a walled tenancy posture
> (`group` / `isolated`) the store is not read at all and its door refuses, naming the posture,
> so a reference resolves from the environment or the host's resolver only. A host resolver that
> throws stays fatal at boot.

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

> **Amendment note (2026-10-27, ADR-0143).** The enterprise bullet above is reversed except for its
> vaulting backend: a vault-backed `CredentialResolver` injected through
> `AutomationServicePluginOptions.credentialResolver` is still the extension point. The open tier
> now adds three variants to `ConnectorInstanceAuthSchema`, each with a closed enum refused at
> publish when unknown:
> - `oauth2`: `authorization_code` with PKCE and refresh, or `client_credentials`;
> - `app-credential`: Feishu, DingTalk or WeCom;
> - `signed`: a closed scheme enum.
>
> It also adds the connection record and the Connect / Reconnect flow. An instance whose grant is
> missing or revoked degrades under the upstream-availability rules below, with a reason that names
> the grant, and never fails a boot. The open-tier bullet's "static auth" list stays true of what
> resolves at materialization.

### Runtime reconcile (follow-up, landed)

Materialization is no longer boot-only. `materializeDeclaredConnectors` is a
**reconcile** against the declared set, run both at boot (`fatal: true`) and on
`metadata:reloaded` (`fatal: false` — a Studio publish / dev reload). The reconcile
adds newly-declared instances, tears down removed / newly-`enabled:false` ones
(calling their `close`), and re-materializes only those whose signature (a stable
hash of `provider` + `providerConfig` + `auth` + identity) changed — an unchanged
MCP instance is never needlessly reconnected. On reload a bad entry (unknown
provider, unresolvable credentialRef, factory failure, name conflict) is **logged
and skipped**, never crashing the live server; a changed instance's old connector
keeps serving until its replacement materializes successfully. Boot keeps the
"fail loudly" contract.

> **Amendment note (2026-10-31, #27429 — after #27237).** An unresolvable `credentialRef` leaves
> the reload list above, as it left the boot list (the note under §6). A reference no source
> answers for degrades the instance naming it, at boot and on a reload alike, and a live
> connector under that name is torn down first instead of serving on: the value it was
> materialized with is gone
> (`packages/services/service-automation/src/plugin.ts#degradeConnectorForCredential`). That is
> how clearing a stored credential (`DELETE /api/v1/automation/connectors/credential-refs/:ref`)
> takes its instances down. A stored credential this deployment cannot read right now (the store
> cannot be read, or no crypto provider is registered yet) degrades the instance too, but leaves a
> live connector serving, since the value still exists. Both go on the backoff under "Upstream
> availability". A host resolver that throws keeps the rule above: fatal at boot, logged and
> skipped on a reload.

### Upstream availability: degrade, don't die (follow-up, landed — #3017)

The fail-loud contract deliberately distinguishes **configuration** faults from
**operational** faults. Unknown provider, invalid `providerConfig`, unresolvable
`credentialRef`, name conflict — authoring mistakes — stay fatal at boot (an unresolvable
`credentialRef` no longer does: see the notes under §6 and under "Runtime reconcile"). But a
provider whose factory must contact an upstream to materialize (the `mcp`
provider connects and calls `tools/list`) can fail because that upstream is
*temporarily unreachable*; aborting the whole app boot for one integration's
network blip turns a degraded connector into a total outage.

A factory signals the operational case by throwing an error carrying the
`CONNECTOR_UPSTREAM_UNAVAILABLE` code (`ConnectorUpstreamUnavailableError` in
`@objectstack/spec/integration`; the materializer's check is structural, not
`instanceof`). The reconcile then — in both boot and reload modes — **degrades**
that one instance instead of failing the run:

- With no live connector under the name, an action-less husk is registered
  (`state: 'degraded'` + `degradedReason` on the descriptor, `status: 'error'`
  on the def) so `GET /connectors` shows the instance honestly instead of it
  silently missing, and a `connector_action` dispatch fails with the reason and
  "the platform retries automatically" — never the generic wiring hint.
- On a changed-config re-materialization, the previous live connector keeps
  serving untouched (the same guarantee every other reload failure gives).
- Degraded instances are retried on an exponential backoff (5s doubling to a
  5-minute ceiling; a config edit resets it) and immediately by any reconcile
  (`metadata:reloaded`). Recovery replaces the husk atomically via
  `registerConnector`; an instance deleted while degraded is dropped, husk and
  pending retry included.

> **Amendment note (2026-10-30, #28038 — after #27992 / PR #28014, #27237, and #28016 / PR
> #28037).** The first and third bullets above are kept as written; they now hold only for an
> instance **on the backoff**. Some degraded instances are **held** instead: a configuration
> fault met by an instance that is already degraded, on its backoff retry or on a
> `metadata:reloaded` reconcile (#27992 — the instance is held with the configuration reason,
> `packages/services/service-automation/src/plugin.ts#failDegradedConnectorInstance`),
> and a credential its upstream refused when the value is stored in `sys_connector_credential`
> or written into the declaration (#27237,
> `packages/services/service-automation/src/plugin.ts#holdConnectorForRejectedCredential`). A
> held instance is not retried: the backoff timer skips it
> (`packages/services/service-automation/src/plugin.ts#scheduleDeclarativeRetry`), and so does a
> reconcile while its signature is unchanged
> (`packages/services/service-automation/src/plugin.ts#reconcileDeclaredConnectors`). An edit
> of its declaration, setting its stored credential again (the row's revision is part of the
> signature), or a restart re-attempts it. Clearing the stored credential also ends the hold,
> since the reference's fingerprint changes: the instance then degrades for the missing
> reference and goes back on the backoff. Its husk carries the hold
> (`packages/services/service-automation/src/engine.ts#getConnectorDegradedHold`), and a
> `connector_action` dispatch to it names what unblocks it instead of promising a retry
> (#28016, `packages/services/service-automation/src/builtin/connector-nodes.ts#registerConnectorNodes`,
> `packages/services/service-automation/src/plugin-extension-api.ts#describeHold`): "Dispatch is
> unavailable until its declaration is edited (or the server restarts); the platform does not
> retry it.", or "… until credential '`<ref>`' is set again (or the server restarts); …". An
> instance on the backoff (an unreachable upstream, or a refused credential read from an
> environment variable or the host's resolver) keeps "Dispatch is unavailable until that is
> resolved; the platform retries automatically."

The `mcp` provider classifies connect / `tools/list` failures as unavailable;
transport-shape validation stays a plain (fatal) throw. Lazy connect-on-first-
dispatch was rejected: MCP actions ARE the server's `tools/list`, so a
connector materialized without connecting would register a zero-action def —
exactly the plausible-but-dead shape this ADR exists to kill.

> **Amendment note (2026-10-27, #26709 item 3(b) — PR #26798).** The sentence
> above has one exception past transport validation: a credential the MCP
> server **rejects** — an HTTP `401` / `403` on connect, handshake or
> `tools/list` — is a **configuration fault**, thrown plain: fatal at boot, a
> skipped entry on reload, never `CONNECTOR_UPSTREAM_UNAVAILABLE` and never
> retried. It sits on the fatal side of this section's own split, beside an
> unresolvable `credentialRef` and the `openapi` provider's non-retryable
> `4xx` (a `401` included) on its spec fetch: retrying cannot make a wrong,
> missing or under-scoped credential valid, and a degraded instance retried
> with backoff reads as "server down", hiding the misconfiguration the author
> has to fix. The rejection is told apart by the MCP SDK's own HTTP-transport
> errors only — a `StreamableHTTPError` with status 401 / 403, or an
> `UnauthorizedError`, in the error's `cause` chain
> (`packages/connectors/connector-mcp/src/mcp-provider.ts#credentialRejectionStatus`, `#createMcpProviderFactory`);
> a JSON-RPC error that merely carries a numeric code 401 stays operational, as
> does every other connect / `tools/list` failure. Pinned against a real
> Streamable-HTTP server in
> `packages/connectors/connector-mcp/src/mcp-http-discovery-faults.test.ts`.

> **Amendment note (2026-10-28, #27237 — ruling on #27237, comment 6470087293).** The note above
> changes on two points. First, a rejected credential no longer fails the boot. The `mcp`
> provider throws `ConnectorCredentialRejectedError` (`CONNECTOR_CREDENTIAL_REJECTED`) at
> materialization; a `rest` or `openapi` instance reports it on the first call answering `401` /
> `403`. Either way the instance is degraded with the upstream's message, never the value.
> Second, whether it is retried follows where the value came from. A value stored in
> `sys_connector_credential` is marked `rejected`, and its instance is held, with no timer retry,
> until the credential is set again, the declaration changes, or the process restarts (a restart
> lifts the hold). An instance with no `credentialRef`, whose credential is written in the
> declaration, is held the same way. The `rejected` mark survives a re-materialization, since a
> `rest` or `openapi` instance materializes without sending the value. Only proof clears it: a
> provider answering `credentialVerified` at materialization (the `mcp` handshake over http), or
> setting the value again. A call answered `2xx` is not proof, since the endpoint may not check
> the credential (a public path, an operation with `security: []`); it only stamps the
> last-verified time of a row still at `set`. A value from an environment variable or the host's
> resolver can change where the process cannot see it (a rotation, or a `403` rate limit that
> lifts), so its instance is retried on the backoff above instead, and the credential listing
> reports the refusal until a provider proves the value, it stops resolving from that source, or
> the process restarts.

The `openapi` provider applies the same split to its **remote-URL spec fetch**:
an unreachable endpoint (network error) or a transient HTTP status
(`408` / `429` / `5xx`, mirroring the `retryableStatusCodes` convention) is
upstream-unavailable — degrade + retry — while a wrong URL (non-retryable
`4xx`) or an unparseable document stays a fatal configuration fault. Inline and
file-path (`#3016`) specs do no boot I/O and are unaffected.

### Declarative stdio policy: default-deny (follow-up, landed — #3055)

A declarative `provider: 'mcp'` entry may name a **stdio transport**, and
materializing one **spawns a local child process** — from *metadata*, which a
runtime Studio publish can introduce (the reload reconcile materializes new
instances; soft mode skips failures, not successes). Anyone who can publish
metadata could otherwise execute commands on the server. Stdio on declarative
instances is therefore **denied by default** and opt-in per host:

```ts
new ConnectorMcpPlugin({ declarativeStdio: ['my-mcp-server'] })  // allowlist
new ConnectorMcpPlugin({ declarativeStdio: true })               // full trust
```

A policy violation is a **configuration fault** — plain throw (fatal at boot,
skipped on reload), never `CONNECTOR_UPSTREAM_UNAVAILABLE`: a security
rejection must not be retried into existence. `http` transports are unaffected
(same trust class as the `http` node), and so are **hand-wired** connectors
(plugin instance options / `createMcpConnector`) — their command lives in host
code, a different trust anchor than metadata. The allowlist is deliberately
honest about being a *coarse* boundary (allowlisting `npx` ≈ allowing any
package it can run); sandboxed execution remains the enterprise tier
(ADR-0024 §4). This gate is the precondition for shipping `connector-mcp` in
any default preset (#3056).

### Deliberate scope boundaries

- **`providerConfig.spec` (openapi)** accepts an inline document, an http(s) URL, **or a package-relative file path** (#3016 follow-up). The connector still owns no filesystem access: the automation service injects a `loadPackageFile` capability into `ConnectorProviderContext` that resolves the ref against the declaring stack/package root (`packageRoot`, CLI default: the `objectstack.config.ts` directory) and **confines reads to that root** — absolute and `..`-escaping paths are rejected. Read/parse failures follow the reconcile policy above: fatal at boot, skipped on reload.
- **MCP credentials** ride the transport (ADR-0024); for an http transport a resolved `auth` is folded into the request headers.
- **A live `provider: 'mcp'` showcase demo** landed with #3056 (#3062): the showcase points a declarative `mcp` instance at an in-repo stdio MCP fixture (`examples/app-showcase/scripts/mcp-fixture.mjs`), spawned under the host `declarativeStdio` allowlist, and a dogfood proof pins materialization + dispatch. Self-connection to the platform's own `@objectstack/mcp` endpoint (which is not listening until after the automation plugin's `start()`) stays out of scope — the fixture sidesteps the boot-ordering timing entirely.
