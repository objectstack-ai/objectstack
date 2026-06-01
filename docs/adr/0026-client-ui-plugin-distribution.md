# ADR-0026: Client-Side UI Plugin Distribution

**Status**: Proposed
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0025](./0025-plugin-package-distribution.md) (plugin package distribution — server/runtime plugins), [ADR-0003](./0003-package-as-first-class-citizen.md) (package + versioned releases), [ADR-0010](./0010-metadata-protection-model.md) (protection model)
**Related**: [ADR-0019](./0019-app-as-consumer-unit.md) (App is the only consumer-facing unit — UI plugins ship inside Apps or are operator-provisioned, see §3.7)
**Consumers**: `@objectstack/client-react`, `@objectstack/console`, `../objectui` (Studio), `@objectstack/spec/system` (ObjectStackManifest), `@objectstack/spec/cloud`

---

## 0. Context

ADR-0025 designs distribution for **server/runtime** plugins (`.osplugin`,
`runtime: node|sandbox|worker`). A scenario review (ADR-0025 §3.10) surfaced a
category it explicitly does **not** cover: **client-side UI plugins** that run in
the browser inside the ObjectUI console SPA —

- **Custom field renderers** (signature pad, rich geo/map, barcode/QR, color
  picker, masked input, dependent-picklist UI).
- **Custom view types** (beyond the built-in grid/kanban/gantt/calendar — e.g.
  org chart, timeline, map view, image gallery).
- **Custom widgets** (KPI/chart variants, embedded BI, custom list cards).
- **Page sections / layout blocks** and behavior-carrying themes.

These cannot ride the server plugin pipeline as-is: they load in the browser,
render React against the host's component model, and must be sandboxed against a
*client* threat model (DOM access, token exfiltration, CSP), not a Node one. The
existing `ObjectStackManifest` already has the declarative seam —
`capabilities.extensionPoints` / `extensions` and `contributes` — and ObjectUI
already has a fixed catalog of view/widget types; what is missing is **how a
third party ships browser code that registers a new field/view/widget at
runtime, and how that code is isolated**.

## 1. Goals & Non-goals

### Goals

- A **client UI plugin artifact** carrying a browser bundle that registers
  field renderers / view types / widgets / page sections into the running
  console via a stable contract.
- **Reuse ADR-0025's distribution backbone** — same `sys_plugin*` registry,
  publish, signing, and install flow; UI plugins are a `runtime: 'ui'` variant of
  the `.osplugin`, not a parallel system.
- A **two-tier loading model** mirroring ADR-0025's trust split: verified →
  in-app module (shared singletons), third-party → **iframe-sandboxed**.
- **Server-authoritative data**: UI plugins read/write only through the client
  SDK under the user's session, so all access stays **RLS-gated server-side** —
  the client grant never bypasses server permissions.
- **Compatibility gating** on the ObjectUI protocol version + shared-singleton
  (React/design-system) version ranges.

### Non-goals

- Server/runtime plugins — covered by ADR-0025.
- A new component framework — UI plugins target React + the host design system.
- Declarative-only UI (themes, translations, view *config*) — that stays an L0
  JSON package (ADR-0025 §3.10); this ADR is for UI that ships *code*.
- Native mobile widgets (separate track).

## 2. Decision

Ship client UI plugins as a **`runtime: 'ui'` variant of the `.osplugin`**
artifact (ADR-0025 §3.1) whose `dist` is a **browser ESM bundle**. The console
loads it at runtime into an **ObjectUI extension registry**, isolating it by trust
tier: **verified** plugins load as in-app modules sharing host singletons;
**third-party** plugins render inside a **sandboxed iframe** that talks to the host
over a constrained `postMessage` RPC bridge. Distribution (publish/sign/install)
is the ADR-0025 pipeline unchanged.

## 3. Detailed design

### 3.1 Artifact & manifest

A UI plugin is an `.osplugin` with:

```jsonc
{
  "id": "com.acme.signature-field",
  "version": "1.0.0",
  "type": "ui-plugin",
  "runtime": "ui",                       // new tier (ADR-0025 §3.6)
  "engines": { "objectui": ">=1.0 <2", "react": "^19" },  // protocol + shared singletons
  "ui": {
    "entry": "dist/plugin.mjs",          // browser ESM, default-exports a register fn
    "shared": ["react", "react-dom", "@objectstack/client-react"],  // host-provided
    "extends": [                         // maps to ObjectStackManifest extensions
      { "point": "fieldType", "name": "signature" },
      { "point": "viewType",  "name": "map" },
      { "point": "widget",    "name": "gauge" }
    ]
  },
  "permissions": {                       // client-scoped (ADR-0025 §3.10 #4)
    "data": { "read": ["account"], "write": [] },  // via client SDK, RLS-gated server-side
    "network": ["tiles.acme.com"],       // becomes per-plugin CSP connect-src
    "navigation": true
  },
  "integrity": { "dist/plugin.mjs": "sha256-..." }
}
```

`extends` reuses the existing `capabilities.extensionPoints`/`extensions` seam;
`ui.shared` lists singletons the host injects (never bundled — same externalize
rule as ADR-0025 §3.3, applied to browser deps).

### 3.2 Extension contract

The entry default-exports a register function called with a typed host API:

```ts
export default function register(host: UiPluginHost) {
  host.registerFieldType('signature', { Display, Edit });   // React components
  host.registerViewType('map', { View });
  host.registerWidget('gauge', { Widget, configSchema });
}
```

Components receive **props only** (value, record context, field config, a scoped
`sdk` for data, a `theme` token set) — no direct access to host stores, router
internals, or other plugins. The contract versions with `engines.objectui`.

### 3.3 Loading & isolation tiers

Mirrors ADR-0025's trust split (default-deny):

| Tier | For | Mechanism | Isolation |
|---|---|---|---|
| **U0 In-app module** | First-party / verified | Native ESM `import()` + import-map (or module federation) sharing `react`/`client-react`/design-system singletons; components mount directly in the host tree | Trust-based; runs with host privileges, gated by declared permissions |
| **U1 Iframe sandbox** | Third-party / unverified (**default**) | Plugin renders inside a `sandbox`ed `<iframe>` (`allow-scripts`, no `allow-same-origin`); host↔plugin via `postMessage` RPC; per-plugin **CSP** from `permissions.network` | Strong: separate origin, no host DOM/token access, no cookie/localStorage of host |

As in ADR-0025 §3.6, `runtime: 'ui'` + **U0** is reserved for verified
publishers and enforced at publish; unverified UI plugins ship **U1 only**.

### 3.4 Data & security model

- **Server-authoritative.** All data access goes through the scoped client `sdk`,
  which calls the same REST API under the **user's session** — every read/write is
  re-checked by server RLS (`plugin-security`). The manifest `permissions.data` is
  a UI-affordance hint and a client-side guard, **not** the security boundary; the
  server is.
- **No host-token leakage.** U1 iframes have no `allow-same-origin`, so they
  cannot read host cookies/`localStorage`; the RPC bridge forwards only the data
  the contract allows, never raw credentials.
- **Per-plugin CSP.** `permissions.network` becomes the iframe's `connect-src` /
  `img-src` allowlist; an unverified widget cannot beacon to arbitrary hosts.
- **Integrity + signing.** Same as ADR-0025 §3.5 — bundle is hashed and signed;
  the console verifies before mounting.

### 3.5 Distribution & install (reuses ADR-0025)

- **Publish**: identical pipeline — `sys_plugin` / `sys_plugin_version` (blob =
  browser bundle) / `marketplace_listed`; publish-time gate enforces the U0/U1
  rule by publisher verification.
- **Install**: `sys_plugin_installation` per environment records the enabled UI
  plugins and granted client permissions. No on-disk Node materialize step — the
  bundle is served to the SPA (via the marketplace proxy / artifact storage) and
  registered into the ObjectUI extension registry at console boot.
- **Local-first parity**: a local `.osplugin` (`runtime: 'ui'`) can be installed
  with no cloud account (ADR-0025 §3.5 local path); the console loads it from the
  local artifact store.

### 3.6 Compatibility

Gate on `engines.objectui` (the ObjectUI extension-contract version) **first**,
then shared-singleton ranges (`react` major must match the host to allow U0 module
sharing; a mismatch forces U1 iframe, which can carry its own React). This is the
client analog of ADR-0025 §3.8 protocol-first gating.

### 3.7 Audience & relation to ADR-0019

As in ADR-0025 §3.11, a UI plugin (`type: ui-plugin`) is an **internal
contribution**, not a consumer-installable unit (ADR-0019 D2:
`isConsumerInstallable` = `type: app` only). It reaches a tenant by the same two
routes:

- **Bundled inside an App** — the App author registers the field/view/widget
  contributions as part of the App bundle; the consumer installs the App and the
  UI extensions load with it. This is the dominant path (a "map view" or
  "signature field" is part of *some App's* UX).
- **Operator-provisioned** — an admin enables a UI plugin org-wide as a console
  capability (e.g. a corporate barcode-scanner field across all Apps).

The consumer never browses a "UI plugin" listing; the U0/U1 loading and isolation
of §3.3 govern *how the host runs* a contribution that arrived by either route.
The signed registry/install backbone is shared with ADR-0025 (and thus the
developer/operator contribution catalog, not the consumer App Marketplace).

## 4. Phasing

- **Phase 1 — Contract & registry.** Define `runtime: 'ui'` + `ui` manifest block
  (Zod, in `@objectstack/spec/system`); ObjectUI extension registry +
  `UiPluginHost` API for fieldType/viewType/widget.
- **Phase 2 — U1 iframe loader (default).** Sandboxed-iframe host + postMessage
  RPC bridge + per-plugin CSP; install/enable via `sys_plugin_installation`;
  scoped data SDK.
- **Phase 3 — U0 module loader.** Import-map / module-federation shared singletons
  for verified plugins; publish-time verification gate.
- **Phase 4 — Authoring.** `os plugin build` UI target (browser bundle,
  externalize shared singletons); Studio "Install UI plugin" + per-env enable.
- **Phase 5 — Page sections / themes-with-behavior** and richer extension points.

## 5. Consequences

### Positive

- Closes the UI-extension gap without forking ADR-0025's distribution backbone.
- Default-deny iframe isolation makes untrusted third-party widgets safe to run in
  the console; verified plugins keep native performance via U0.
- Server-authoritative data means a compromised/malicious widget still cannot
  exceed the user's RLS-granted access.

### Negative

- Two loaders (U0 module + U1 iframe) to build and keep contract-compatible.
- Iframe RPC adds latency/serialization overhead vs. in-tree components (mitigated
  by reserving U1 for untrusted plugins).
- A stable `UiPluginHost` contract is now a public API surface that must version
  carefully.

### Neutral

- Declarative UI (themes/translations/view config) is unaffected — stays L0 JSON.
- Reuses ADR-0025 signing, registry, and install records verbatim.

## 6. Alternatives considered

1. **Server-render plugin UI (no client code).** Rejected: too limiting for rich
   interactions (maps, signature, drag-drop); the console is a client SPA.
2. **Web Components instead of React contract.** Considered; deferred — the host is
   React and the design system is React; a WC bridge can come later for framework
   neutrality.
3. **Always in-app modules (no iframe).** Rejected: a third-party module in the
   host tree can read tokens and the whole DOM — unacceptable for an open
   marketplace. Iframe must be the third-party default.
4. **A separate UI-plugin registry.** Rejected: forks ADR-0025; `runtime: 'ui'`
   keeps one pipeline.

## 7. Open questions

- **Module federation vs. native import-map** for U0 — which gives cleaner
  singleton sharing across host + plugin React?
- **RPC contract surface** — minimal `sdk` for U1 (data CRUD, navigation, toast,
  file pick) without re-exposing the whole client SDK.
- **Design-system theming across the iframe boundary** — pass tokens via CSS vars
  / `postMessage`, or ship a lightweight themed component kit to U1 plugins?
- **Offline/local-first** — how do UI plugin bundles cache for offline console use
  (service worker), consistent with the local-first install path?

## 8. References

- [ADR-0025](./0025-plugin-package-distribution.md) — Plugin package distribution (server); `runtime` tiers, signing, registry, §3.10 refinements
- [ADR-0019](./0019-app-as-consumer-unit.md) — App is the only consumer-facing unit; UI plugins ship inside Apps or are operator-provisioned (§3.7)
- [ADR-0010](./0010-metadata-protection-model.md) — Protection model (lock states for installed UI extensions)
- `packages/client-react/` — React client SDK + view/field rendering
- `packages/console/` — console SPA (load target for UI plugins)
- `packages/plugins/plugin-security/` — RLS that keeps data access server-authoritative (§3.4)
- `packages/spec/src/system/` — `ObjectStackManifest` `capabilities.extensionPoints`/`extensions` seam reused by `ui.extends`
