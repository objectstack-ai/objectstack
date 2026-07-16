---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/connector-rest': minor
'@objectstack/connector-openapi': minor
'@objectstack/connector-mcp': minor
---

feat(connectors): ADR-0096 — provider-bound declarative connector instances materialized at boot (#2977)

Declarative `connectors:` stack entries used to be **descriptor-only** (#2612):
registered as metadata but never dispatchable, the platform's one dead metadata
surface. An entry may now name a **`provider`** — an installed generic executor
(`openapi` / `mcp` / `rest`) — and the automation service **materializes** it
into a live, dispatchable connector at boot. AI can now wire an integration as
pure metadata and a flow `connector_action` calls it end-to-end.

- **Schema (`@objectstack/spec`).** `ConnectorSchema` gains `provider`,
  `providerConfig`, and `auth` (a `credentialRef`-based instance-auth shape —
  `ConnectorInstanceAuthSchema` — that references credentials, never inlines
  them); `authentication` now defaults to `{ type: 'none' }` so a provider-bound
  instance need not author it (loosening — existing connectors are unaffected).
  `DeclarativeConnectorEntrySchema` (used by `stack.zod.ts`) rejects inline
  secrets, orphan `providerConfig`/`auth`, and authored `actions`/`triggers` on a
  provider-bound entry. A new `integration/connector-provider.ts` defines the
  provider-factory contract as pure types.

- **Engine + boot (`@objectstack/service-automation`).** The engine adds a
  connector-provider registry (`registerConnectorProvider`/`getConnectorProvider`)
  and origin-tags registered connectors. At boot the service resolves each
  provider-bound entry — looking up the factory, resolving `auth.credentialRef`
  via a pluggable `CredentialResolver` (open-tier default: environment
  variables), and registering the materialized connector. Boot **fails loudly**
  for an unknown provider, invalid `providerConfig`, an unresolvable
  `credentialRef`, or a name conflict with a plugin-registered connector (no
  silent precedence).

- **Providers (`connector-rest` / `connector-openapi` / `connector-mcp`).** Each
  plugin registers a provider factory in `init()` reusing its existing
  generator/adapter API. Plugin options are now **optional**: with none the
  plugin contributes only its provider factory; with instance options it also
  registers a hand-wired connector (back-compat). `connector-openapi` adds a
  `ConnectorOpenApiPlugin`.

Open tier: static auth (`none`/`api-key`/`basic`/`bearer`) with `credentialRef`
resolved from env vars. Managed vaulting, OAuth2 refresh, and per-tenant
connection lifecycle remain the enterprise tier (ADR-0015) — an enterprise host
injects a vault-backed `CredentialResolver` with no change to the materialization
path.
