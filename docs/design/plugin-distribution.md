# Design Document: Plugin Distribution — Code-Bearing Contributions

> **Author:** ObjectStack Core Team
> **Created:** 2026-06-01
> **Status:** Design Specification
> **Decisions:** [ADR-0025](../adr/0025-plugin-package-distribution.md) (server/runtime plugins), [ADR-0026](../adr/0026-client-ui-plugin-distribution.md) (client UI plugins)
> **Companion to:** [`marketplace-publishing.md`](./marketplace-publishing.md) (metadata-package / App flow)

---

## Table of Contents

- [1. Scope & Relationship to the App Marketplace](#1-scope--relationship-to-the-app-marketplace)
- [2. The Three Distribution Layers](#2-the-three-distribution-layers)
- [3. What Belongs in the Contribution Catalog](#3-what-belongs-in-the-contribution-catalog)
- [4. Artifact Format](#4-artifact-format)
- [5. Build → Sign → Publish](#5-build--sign--publish)
- [6. Install & Load](#6-install--load)
- [7. Trust & Isolation Tiers](#7-trust--isolation-tiers)
- [8. Security Model](#8-security-model)
- [9. Versioning & Lifecycle](#9-versioning--lifecycle)
- [10. Worked Examples](#10-worked-examples)
- [11. Open Questions](#11-open-questions)

---

## 1. Scope & Relationship to the App Marketplace

This document operationalizes how **code-bearing contributions** (plugins with
executable code + npm dependencies, and client UI plugins) are built, signed,
distributed, and loaded. It is the supply-side companion to
[`marketplace-publishing.md`](./marketplace-publishing.md), which covers the
**consumer-facing App** flow (metadata packages).

**Audience boundary (ADR-0019).** The consumer Marketplace lists **only Apps**
(`type: app`; `isConsumerInstallable`). Plugins, drivers, UI extensions, themes,
agents, and other internal contributions are **never** browsed or installed by an
end consumer. They reach a tenant by exactly two routes:

1. **Bundled inside an App** — the App author composes them as build-time
   dependencies (`plugins: [...]` in `defineStack`), and the consumer installs the
   App as one atomic unit.
2. **Operator-provisioned** — a platform operator/admin installs them into a
   runtime/environment out-of-band (drivers, auth providers, connectors,
   observability exporters).

Accordingly there are **two catalogs over one backbone**:

| | Consumer App Marketplace | Developer/Operator Contribution Catalog |
|---|---|---|
| Lists | `type: app` only | `plugin`/`driver`/`ui`/`server`/`agent`/… |
| Who installs | Any tenant user | App authors (compose) / operators (provision) |
| Surface | Console "App Marketplace" | CLI `os plugin …` + operator/dev tooling |
| Backbone | shared `sys_*` registry, signing, artifact storage | same |

This design specifies the **contribution catalog + backbone**. It does **not**
open a self-serve consumer-facing code marketplace — that remains the gated bet
ADR-0019 §Out-of-scope parks, whose load-bearing wall (L2 sandbox + permission
enforcer) is precisely what §7–§8 here build and harden.

## 2. The Three Distribution Layers

The "metadata vs code" split is really a spectrum (ADR-0025 §3.10). Choosing a
layer is a single question: **does it need to execute code / reach an external
system?**

| Layer | Form | Trust decision at install | Channel | Doc |
|---|---|---|---|---|
| **L0 — declarative** | objects/views/flows/dashboards/permissions/themes/translations JSON | none (it is data) | JSON hot-register | `marketplace-publishing.md` |
| **L1 — declarative + sandboxed script** | JSON carrying L1 expressions / L2 `ScriptBody` (validations, formulas, small automations) | "scripts allowed" only; runs in the existing QuickJS sandbox | JSON flow — no `.osplugin` | this doc §7 (T1) |
| **L2 — code plugin** | npm deps + host APIs (drivers, connectors, AI, auth, …) | explicit permission consent + signature | `.osplugin` | this doc |

**Design consequence:** most "custom logic" is L1 and never touches the heavy
code-plugin pipeline. Reserve L2 (and this document's machinery) for
contributions that genuinely carry dependencies or reach the host/network.

## 3. What Belongs in the Contribution Catalog

A scenario-driven catalog, with the recommended layer/tier for each. (Items
already present in `packages/plugins/*` are marked ✅.)

| Category | Examples | Layer | Tier | Notes |
|---|---|---|---|---|
| **Data-source drivers** | MongoDB ✅, SQL ✅, SQLite-WASM ✅, ClickHouse, Redis, S3 | L2 | T0 | Implements the storage protocol; holds a client/pool. Operator-provisioned. |
| **Connectors / integrations** | Salesforce, Stripe, Slack, Twilio, SAP, Shopify, GitHub, DocuSign, WeCom/DingTalk | L2 (declarative sub-path) | T0 internal / **T2 third-party** | OpenAPI/MCP-describable ones are **declarative** (ADR-0023/0024); only custom-auth/pagination/streaming fall to code. Secrets via KV (ADR-0007). |
| **AI / ML extensions** | LLM providers, Embedder ✅, vector stores, RAG backends ✅, reranker, OCR/speech, agent tools | L2 | T0/T2 | Network + service permissions; agent tools may run T1. |
| **Identity / auth** | SAML/OIDC SSO ✅, SCIM, LDAP, MFA | L2 | T0 | First-party/verified; deep host hooks. Operator-provisioned. |
| **Automation / channels / notifications** | record-change ✅ & schedule ✅ triggers, Webhooks ✅, FCM/APNs, SMS, email ✅, bidirectional channels | L2 (+ some L1) | T0/T2 | Small rules are L1; channel adapters are L2. |
| **Governance / observability** | audit ✅, RBAC/RLS ✅, org-scoping ✅, masking/DLP, backup, OTel/Datadog/Sentry exporters | L2 | T0 | First-party/verified; compose with RLS (§8). |
| **Protocol / server surfaces** | HTTP/GraphQL/gRPC gateway ✅ (hono), MCP server ✅, REST | L2 | T0 | Operator-provisioned. |
| **Business rules / formulas** | validation packs, computed-field libs, approval conditions, field dependencies | **L1** | T1 | Ride the JSON flow + sandbox; **no `.osplugin`**. |
| **Vertical apps & templates** | CRM, PM, HRM, ITSM, dashboards, report/theme/translation/permission packs | **L0** | — | Consumer **Apps** / declarative packages — *not* this catalog. |
| **Client UI extensions** | field renderers (signature, map, barcode), view types (org-chart, timeline, map), widgets | UI (ADR-0026) | U0/U1 | Browser bundle; bundled in an App or operator-provisioned. |

**Best fit for the `.osplugin` L2 pipeline:** drivers, connectors, AI extensions,
auth providers, notification/channel adapters, observability exporters, server
surfaces — each is *bounded code + deps + a clear capability/permission surface*
that maps cleanly onto the manifest's `capabilities`/`permissions` and the tiers.

**Deliberately NOT code plugins:** vertical apps/templates/themes (L0) and
validation/formula logic (L1) — making these `.osplugin` artifacts would be
over-engineering.

## 4. Artifact Format

### 4.1 `.osplugin` (server/runtime — ADR-0025 §3.1–§3.2)

A `tar.gz`:

```
<id>-<version>.osplugin
├── objectstack.plugin.json   # compiled manifest (below)
├── dist/                     # pre-built ESM bundle (tsup); @objectstack/* externalized
├── package.json              # only for the manifest-deps strategy
├── pnpm-lock.yaml            # only for the manifest-deps strategy
├── assets/ README LICENSE icon
└── SIGNATURE                 # detached signature + publisher cert chain
```

Compiled manifest adds four blocks to the existing `ObjectStackManifest`:
`engines` (protocol + platform ranges), `runtime` (`node|sandbox|worker`),
`packaging` (`bundled|manifest-deps`), `permissions` (services/hooks/network/fs
+ RLS data scopes), and `integrity` (per-file hashes).

### 4.2 UI plugin (`runtime: 'ui'` — ADR-0026 §3.1)

Same `.osplugin` envelope, but `type: ui-plugin`, `dist` is a **browser ESM
bundle** default-exporting a `register(host)` function, and the manifest carries a
`ui` block (`entry`, `shared` singletons, `extends` extension points) plus
client-scoped `permissions` (data read/write via SDK, network → CSP, navigation).

### 4.3 Packaging strategies (default: bundled)

- **Bundled (default).** `tsup --noExternal` bundles third-party JS into `dist`;
  no npm at install time. **`@objectstack/*` is externalized** as a host-provided
  peer-dep singleton (bundling it forks the engine — duplicate registries / broken
  `instanceof` / double Zod validation). Native addons disallowed.
- **manifest-deps (opt-in).** Ships `package.json` + lockfile; install runs
  `pnpm install --frozen-lockfile --ignore-scripts`. For native addons / huge
  deps only; disallowed for unverified publishers.

## 5. Build → Sign → Publish

```
os plugin build  →  os plugin sign  →  os plugin publish
```

1. **build** — run `tsup` (externalize `@objectstack/*`); validate the manifest
   (Zod + the new `permissions` schema); gate on protocol/engine compatibility;
   compute per-file `integrity`; emit `<id>-<version>.osplugin`.
2. **sign** — sign with the publisher key (`PluginMetadata.signature`); may be
   server-side at publish.
3. **publish** — extends `os package publish`:
   - `POST /cloud/plugins` → ensure a `sys_plugin` row (reverse-domain id, owner
     org).
   - `POST /cloud/plugins/:id/versions` → upload the `.osplugin` blob to object
     storage; store manifest/permissions/integrity/signature/engines/size/SBOM in
     `sys_plugin_version` (`status: pending_review → published`).
   - **Server gates:** schema validation; secret/malware/known-vuln scan;
     **permission audit** (sensitive permissions → human review); **publish-time
     tier enforcement** (an unverified publisher cannot ship `runtime: 'node'` or
     `manifest-deps`); marketplace **counter-signs** with the platform key on
     approval.
   - Listed in the **contribution catalog** (not the consumer App Marketplace),
     with a "contains code" badge and a permission-disclosure screen.

## 6. Install & Load

Install is a deliberate, **permissioned** action performed by a developer
(composing an App) or an operator (provisioning a runtime):

```
resolve → compat check → permission consent → download+verify → materialize → register → load
```

1. **Resolve** `id@version` (or latest matching the engine/protocol range) → manifest,
   download URL, signature, declared permissions, dependency closure.
2. **Compatibility (protocol-first).** Verify the host provides each
   `capabilities.implements[].protocol` at a compatible version; then
   `engines.platform`/`engines.protocol` as a secondary guard. Topologically order
   plugin→plugin `requires`; fetch deps.
3. **Permission consent.** Present declared permissions (services / hooks / fs /
   network hosts / RLS data scopes / extension points). The **granted set** is
   persisted and enforced by `PluginPermissionEnforcer`. Secret-typed config fields
   are wired to the KV secret store (ADR-0007) — never stored in the artifact.
4. **Download + verify.** Verify signature (publisher + marketplace keys) and each
   file against `integrity`; reject on mismatch.
5. **Materialize.** Unpack to `<OS_HOME>/plugins/<env>/<id>/<version>/`;
   manifest-deps runs `pnpm install --frozen-lockfile --ignore-scripts` here.
6. **Register.** Write `sys_plugin_installation` (env_id, plugin_id, version_id,
   granted_permissions incl. RLS scopes, status, is_preview). Persist to a local
   store so installs survive restarts (the ADR-0016 §9.7 disable-state pattern).
7. **Load + activate.** On boot (or hot, when `hotReloadable`), the loader scans
   installed plugins, dynamic-imports the entry, wraps `PluginContext` with the
   enforcer scoped to the granted set, and runs `init → start` in dependency
   order. `contributes` metadata is hot-registered like a pure-element package.

**Local-first parity.** `os plugin install ./x.osplugin` (and a Studio upload for
operators) hit a `marketplace/install-local`-style endpoint (inline artifact,
register-before-persist per ADR-0016 §9.3). Local artifacts need no cloud account;
signature is still verified (or `--trust-unsigned` for dev).

**UI plugins (ADR-0026 §3.5).** No on-disk Node materialize — the browser bundle
is served to the SPA and registered into the ObjectUI extension registry at console
boot; `sys_plugin_installation` records enabled UI plugins + client grants.

## 7. Trust & Isolation Tiers

Server/runtime (ADR-0025 §3.6), **default-deny**:

| Tier | `runtime` | Load | For | Mechanism |
|---|---|---|---|---|
| **T0 Trusted** | `node` | in-process dynamic `import` | first-party / verified / enterprise-signed | full `PluginContext`, capability-gated |
| **T1 Sandboxed** | `sandbox` | QuickJS-WASM (`quickjs-runner.ts`) | pure-logic plugins (hooks/formulas/transforms) — also the L1 layer | no Node API; only gated `ctx.api/crypto/log` |
| **T2 Out-of-process** | `worker` | worker/child-process/WASM + RPC | untrusted 3rd-party needing richer APIs | crash/timeout/memory isolation |

**T0 is opt-in, not default.** In-process = arbitrary code in the host process =
the platform's biggest risk surface; it is reserved for verified publishers and
enforced at publish. Unverified third-party plugins default to T1/T2.

Client UI (ADR-0026 §3.3): **U0 in-app module** (verified; shared React/design-
system singletons) vs **U1 iframe sandbox** (third-party default; `postMessage`
RPC + per-plugin CSP, no `allow-same-origin`).

## 8. Security Model

Reuses existing components, adds two compositions:

- **Signing.** Publisher signs; marketplace counter-signs on approval; host ships
  trusted roots; verify chain at install **and** load.
- **Permissions + RLS.** The coarse service/hook/file/network gate
  (`PluginPermissionEnforcer`) is **composed with object/field-level security**
  (`plugin-security`/RLS): data-affecting grants reference RLS scopes, so a
  connector authorized for `account` reads still cannot exceed field-level RLS.
  All denials logged. (ADR-0025 §3.10 #4.)
- **Secrets.** `configuration` secret fields → KV secret store (ADR-0007) via
  secret-refs; the artifact never carries credentials; the plugin reads them
  through `PluginContext` gated by the network/service permission.
- **Supply chain.** Lockfile + per-file integrity; server-side secret/vuln scans;
  SBOM on the version row; **always `--ignore-scripts`** (no `postinstall`).
- **Server-authoritative UI data.** UI plugins read/write only via the client SDK
  under the user's session → every access re-checked by server RLS; manifest
  `permissions.data` is a UI hint/guard, not the boundary. U1 iframes cannot read
  host cookies/tokens.
- **Reversible disable.** Reuse package enable/disable + disable-state-store
  (ADR-0016 §9.5/§9.7).

## 9. Versioning & Lifecycle

Parallel to packages: `sys_plugin` (identity) / `sys_plugin_version` (immutable
semver, checksum, signature, permissions, engines, SBOM, blob pointer) /
`sys_plugin_installation` (env ↔ version, granted permissions, is_preview).

- **Compatibility** gated protocol-first (§6 step 2). Support deprecate/yank.
- **Update** = install the new version side-by-side, swap the installation
  pointer. **If the new version widens permissions** (services, hooks, network
  hosts, or RLS scopes), **require re-consent** before activation.
- **Disable** stops loading code + unregisters contributions on next boot;
  reversible and non-destructive.

## 10. Worked Examples

**A. ClickHouse driver (operator-provisioned, T0).**
`type: driver`, `runtime: node`, implements `storage.protocol.v1`, `permissions:
{ network: ['clickhouse.internal'] }`, secret DSN via KV. Operator runs
`os plugin install`, consents to the network grant, the driver registers into the
driver registry on boot. Never in the consumer Marketplace.

**B. Stripe connector bundled into a "Billing" App (T0 internal).**
App author composes `@acme/connector-stripe` (`.osplugin`) as a build-time
dependency; the connector's `permissions` (network `api.stripe.com`, RLS write on
`invoice`) surface in the App's permission-disclosure screen. The consumer installs
the **App**; the connector rides inside it. Stripe API key → KV secret-ref at App
install.

**C. Community "fancy gauge" widget (UI, U1 default).**
`type: ui-plugin`, `runtime: ui`, unverified publisher → **U1 iframe** only, CSP
`connect-src` empty, data via scoped SDK (RLS-gated). Bundled into whatever App's
dashboard uses it, or operator-enabled org-wide.

**D. A validation pack (L1, no `.osplugin`).**
A "VAT number format" check ships as JSON with an L2 `ScriptBody`; installs via the
normal JSON package flow, runs in the QuickJS sandbox (T1). No signing, no
permission prompt, no artifact.

## 11. Open Questions

- **Key management & rotation** for publisher and host root keys.
- **Permission-widening UX** on update — auto-disable until re-consent vs. run on
  old grant.
- **T2 RPC surface** — the minimal host-service contract an out-of-process plugin
  gets, mediated by the enforcer.
- **Cross-plugin dependency conflicts** (diamond/version) at install time.
- **UI U0 sharing** — module federation vs. native import-map for React/design-
  system singletons.
- **When (if ever) to open the self-serve consumer code marketplace** — the
  ADR-0019 gated bet, contingent on proving §7–§8 hardness.

---

**End of Document**
