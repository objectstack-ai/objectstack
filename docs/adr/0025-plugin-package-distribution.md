# ADR-0025: Plugin Package Distribution (Code + Dependencies)

**Status**: Proposed
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package + versioned releases), [ADR-0004](./0004-cloud-multi-kernel.md) (cloud multi-kernel), [ADR-0010](./0010-metadata-protection-model.md) (L1/L2/L3 protection), [ADR-0016](./0016-studio-package-authoring-and-publish.md) (package authoring & publish, local export/import)
**Consumers**: `@objectstack/core` (kernel, plugin-loader, security), `@objectstack/runtime` (sandbox, marketplace install), `@objectstack/cli`, `@objectstack/spec/system` (ObjectStackManifest), `@objectstack/spec/cloud`, `../objectui` (Studio)
**Related**: [ADR-0019](./0019-app-as-consumer-unit.md) (App is the only consumer-facing unit — this pipeline serves developers/operators, see §3.11), [ADR-0026](./0026-client-ui-plugin-distribution.md) (client-side UI plugins — out of scope here), [ADR-0007](./0007-settings-manifest-and-kv-store.md) (settings + secret store), [ADR-0022](./0022-connectors-vs-messaging-channels.md)/[ADR-0023](./0023-openapi-to-connector-generator.md)/[ADR-0024](./0024-mcp-connectors.md) (connectors)

---

> **Revision note (2026-06-01) — read §3.10 first.** §§1–3.9 capture the original
> two-channel framing (declarative JSON package vs. `.osplugin` code plugin).
> A scenario review (what the marketplace actually needs to carry) surfaced six
> refinements, consolidated in **§3.10**. The headline corrections: (1) trust is
> **default-deny** — third-party plugins default to an isolated tier, in-process
> `node` is opt-in via verification; (2) `@objectstack/*` deps are **externalized
> as peer deps** (host-provided singletons), never bundled; (3) compatibility is
> gated **protocol-first**, not on platform semver; (4) plugin permissions compose
> with the **object/field-level RLS** layer; (5) secrets live in the **settings/KV
> store** (ADR-0007), never in the artifact; (6) connectors span a declarative
> (OpenAPI/MCP-generated) sub-path, not only hand-written code plugins. Client-side
> **UI** plugins are split out to ADR-0026. **Audience (§3.11):** per ADR-0019 the
> only consumer-facing unit is the **App**; this `.osplugin` pipeline serves
> **developers/operators/ISVs** — plugins reach a tenant *bundled inside an App* or
> *operator-provisioned*, never browsed/installed by an end consumer.

---

## 0. Context

ObjectStack already ships a clean, low-risk distribution path for
**pure-element packages** (metadata-only): a package is authored visually in
Studio, bound to a `package_id`, compiled/exported to a single self-contained
JSON manifest, and installed by **hot-registering** that JSON into the running
engine (`engine.registerApp`). The publish/install loop is trivial precisely
because the artifact is *declarative data* — no code runs, so there is nothing
to build, no dependencies to resolve, and no trust boundary to cross.

- Publish: `os package publish` → `POST /cloud/packages` → `POST
  /cloud/packages/:id/versions` (snapshots `dist/objectstack.json` into
  `sys_package_version.manifest_json`). See
  `packages/cli/src/commands/package/publish.ts`.
- Install (cloud): browse via `MarketplaceProxyPlugin`, install on cloud.
- Install (local): `POST /api/v1/marketplace/install-local` with an inline
  manifest, hot-registered into the kernel and cached on disk. See
  `packages/runtime/src/cloud/marketplace-install-local-plugin.ts` and
  ADR-0016 §9.

The next step is **plugins**: distributable units that contain **executable
code and npm dependencies**, not just metadata. The repository already has the
*authoring* half of this story:

- `packages/plugins/*` are real npm packages — each has a `package.json` (deps,
  `tsup` build → `dist/`), an `objectstack.config.ts` exporting an
  `ObjectStackManifest` (`id`, `type`, `capabilities` =
  implements/provides/requires/extensionPoints/contributes, `configuration`
  schema), and a `src/index.ts` with a lifecycle entry point.
- The microkernel can already *load* code plugins: `packages/core/src/
  plugin-loader.ts` (dependency ordering, health checks, `signature` field,
  `startupTimeout`, `hotReloadable`), `packages/core/src/types.ts` (`Plugin`
  with `init/start/destroy` + `PluginContext`),
  `packages/core/src/security/plugin-permission-enforcer.ts`
  (capability-based service/hook/file/network enforcement),
  `PluginConfigValidator`, and `packages/runtime/src/sandbox/quickjs-runner.ts`
  (a QuickJS-WASM sandbox that wires only capability-gated `ctx.api/crypto/log`
  into untrusted code).

**What is missing is the distribution layer**: there is no artifact format for
code plugins, no build→sign→publish pipeline, and no permissioned install flow.
A code plugin cannot be a JSON blob — it must be built, its dependencies must
be resolved, and because it executes inside (or alongside) the host process it
introduces a **trust boundary** the JSON flow never had.

## 1. Goals & Non-goals

### Goals

- A distributable **plugin artifact** (`.osplugin`) for code + dependencies,
  built deterministically from a plugin source package.
- A **build → sign → publish** pipeline that extends `os package publish`
  rather than forking a parallel system.
- A **permissioned install flow**: compatibility check → explicit permission
  consent → verified download → materialize → register → load.
- A **trust/isolation tiering** that decides *how* plugin code is loaded
  (in-process, sandboxed, out-of-process), reusing the existing loader,
  permission enforcer, and QuickJS sandbox.
- **Local-first parity** (ADR-0016 §9): install a local `.osplugin` with no
  cloud account, mirroring `marketplace/install-local`.
- **Unification**: a pure-element package is the degenerate case of a plugin
  (empty `dist`, no permissions); both go through one install superset.

### Non-goals

- Marketplace monetization / billing (separate `service-marketplace`).
- A from-scratch package registry: we reuse the `sys_*` schema family and add
  blob storage for the artifact.
- Full out-of-process isolation (Tier 2) in v1 — the design reserves the seam
  but the first slice targets Tier 0/Tier 1.
- Replacing the metadata-only JSON flow — it remains the fast path and becomes
  a special case.
- **Client-side UI plugins** (custom field renderers, view types, widgets) —
  these load in the browser and need a different module/sandbox model; see
  ADR-0026.
- **Sandboxed-script packages** (validations, formulas, small automations) — these
  ride the existing JSON flow + QuickJS bodies (the "L1" layer in §3.10) and need
  neither the `.osplugin` pipeline nor an install-time permission prompt.

## 2. Decision

Introduce a **signed `.osplugin` artifact**, a **build/sign/publish pipeline**
that stores both browsable JSON metadata *and* the binary artifact, and a
**permissioned install flow** governed by trust tiers. Default packaging is
**bundled** (dependencies pre-bundled into `dist`) so that, like the JSON flow,
install is "unpack + verify" with **no npm at install time**.

## 3. Detailed design

### 3.1 Artifact format — `.osplugin`

A `.osplugin` is a `tar.gz`:

```
<id>-<version>.osplugin
├── objectstack.plugin.json   # compiled manifest (see §3.2)
├── dist/                     # pre-built ESM bundle (tsup output)
├── package.json              # runtime deps — only for the manifest-deps strategy
├── pnpm-lock.yaml            # locked deps — only for the manifest-deps strategy
├── assets/ README LICENSE icon
└── SIGNATURE                 # detached signature + publisher cert chain
```

### 3.2 Compiled manifest (`objectstack.plugin.json`)

Extends the existing `ObjectStackManifest` with three new blocks
(`engines`, `runtime`, `permissions`, `integrity`):

```jsonc
{
  "id": "com.acme.crm-enrich",
  "version": "1.2.0",
  "type": "plugin",
  "engines": { "platform": ">=4.0 <5", "protocol": ">=1.0" },
  "runtime": "node",                  // node | sandbox | worker  (see §3.6)
  "packaging": "bundled",             // bundled | manifest-deps  (see §3.3)
  "permissions": {                    // explicitly requested capabilities
    "services": ["object", "http"],
    "hooks": ["record.beforeInsert"],
    "network": ["api.acme.com"],
    "fs": []
  },
  "integrity": { "dist/index.mjs": "sha256-..." },  // per-file hashes
  "configuration": { /* existing config schema (PluginConfigValidator) */ },
  "capabilities": { /* existing implements/provides/requires/contributes */ },
  "contributes": { /* OPTIONAL declarative metadata: objects/views/flows/... */ }
}
```

`permissions` is the one new protocol surface the runtime must understand at
install/load time; everything else is additive. `permissions` maps 1:1 onto the
checks the existing `PluginPermissionEnforcer` already implements
(`canAccessService`, `canTriggerHook`, `canReadFile/Write`, `canNetworkRequest`).

### 3.3 Packaging strategies (default: bundled)

- **Bundled (default, recommended).** `tsup` with `noExternal` bundles all JS
  dependencies into `dist`. Native (`.node`) addons are disallowed. Install =
  unpack + verify; **no npm/toolchain at install time**. This is the closest
  analog to the JSON flow and keeps the security surface minimal.
- **manifest-deps (opt-in).** Ships `package.json` + `pnpm-lock.yaml`; install
  runs `pnpm install --frozen-lockfile --ignore-scripts` in an isolated dir.
  Only for plugins that genuinely need native addons or very large deps; slower
  and requires a toolchain/network at install. Disallowed for unverified
  publishers (§3.7).

**Externalize the host runtime (both strategies).** `@objectstack/*` packages
(`core`, `spec`, …) are declared as **peerDependencies** and marked `external` in
the bundle — the plugin binds to the **host's** copy at load time. Bundling them
would create a second engine/Zod instance inside the plugin (duplicate registries,
broken `instanceof`, double validation). Rule: **bundle third-party libs,
externalize `@objectstack/*` (host-provided singletons)**. Version compatibility
of these peers is gated by §3.8.

### 3.4 Build → sign → publish pipeline

```
os plugin build  →  os plugin sign  →  os plugin publish
```

1. **build** — run `tsup`; validate the manifest (Zod `ObjectStackManifest` +
   new `permissions` schema); check `engines.platform/protocol`; compute
   per-file `integrity` hashes; emit `<id>-<version>.osplugin`.
2. **sign** — sign the artifact with the publisher key (reuses the
   `PluginMetadata.signature` field). May be done server-side at publish.
3. **publish** — extends `os package publish`:
   - `POST /cloud/plugins` → ensure a `sys_plugin` row (reverse-domain `id`,
     `owner_org_id`).
   - `POST /cloud/plugins/:id/versions` → upload the `.osplugin` blob to object
     storage; store metadata (manifest, `permissions`, `integrity`, signature,
     `engines`, size, SBOM) in `sys_plugin_version` with
     `status: pending_review → published`.
   - **Server-side gates**: manifest schema validation; secret/malware/known-vuln
     dependency scan; **permission audit** (sensitive permissions trigger human
     review); marketplace **counter-signs** with the platform key on approval.
   - `marketplace_listed` flag reuses ADR-0016's catalog model so plugins appear
     in the same marketplace as packages, with a "contains code" badge and a
     permission-disclosure screen.

The registry therefore stores **both** the browsable JSON metadata (unified
marketplace UX with packages) **and** the binary artifact blob.

### 3.5 Install flow

Install is a deliberate, **permissioned** action — the key difference from the
JSON flow:

```
resolve → compat check → permission consent → download+verify → materialize → register → load
```

1. **Resolve.** Ask the registry for `id@version` (or latest matching the engine
   range); receive manifest + download URL + signature + declared permissions +
   dependency closure.
2. **Compatibility.** Verify `engines.platform/protocol` against the host;
   resolve plugin→plugin `requires` deps and topologically order them (reuse the
   loader's dependency ordering); fetch deps too.
3. **Permission consent (new).** Present the declared `permissions` (services /
   hooks / fs / network / extension points) to the admin. The **granted set** is
   persisted and later enforced by `PluginPermissionEnforcer`.
4. **Download + verify.** Download the `.osplugin`; verify the signature against
   trusted publisher + marketplace keys; verify each file against `integrity`.
   Reject on any mismatch.
5. **Materialize.** Unpack to a per-environment, per-plugin dir
   `<OS_HOME>/plugins/<env>/<id>/<version>/`. For manifest-deps, run
   `pnpm install --frozen-lockfile --ignore-scripts` here.
6. **Register.** Write `sys_plugin_installation` (`env_id`, `plugin_id`,
   `version_id`, `granted_permissions`, `status`, `is_preview`) — parallel to
   `sys_package_installation`. Persist to a local store so installs survive
   restarts (reuse the ADR-0016 §9.7 `package-state-store.ts` pattern).
7. **Load + activate.** On next boot (or hot, when `hotReloadable`), the loader
   scans installed plugins, dynamic-imports the entry, wraps `PluginContext`
   with the enforcer scoped to the granted set, and runs `init → start` in
   dependency order. If the plugin also has `contributes` metadata, that JSON is
   hot-registered exactly like a pure-element package.

**Local-first parity.** `os plugin install ./foo.osplugin` and a Studio "Install
plugin" upload both hit a `marketplace/install-local`-style endpoint (inline
artifact, register-before-persist per ADR-0016 §9.3). Local artifacts need no
cloud account; signature verification is still performed (publisher key or an
explicit `--trust-unsigned` dev override).

### 3.6 Trust / isolation tiers

Because plugins execute code, the manifest's `runtime` field selects *how* the
code is loaded:

| Tier | `runtime` | How loaded | For | Status |
|---|---|---|---|---|
| **T0 Trusted** | `node` | In-process dynamic `import`; full `PluginContext` gated by declared capabilities | First-party / org-signed / verified plugins | loader exists |
| **T1 Sandboxed** | `sandbox` | QuickJS-WASM (`quickjs-runner.ts`); no Node API; only capability-gated `ctx.api/crypto/log` | Pure-logic plugins (hooks, formulas, transforms) | sandbox exists; extend to "script plugins" |
| **T2 Out-of-process** | `worker` | Worker thread / child process / WASM component + RPC bridge; crash/timeout/memory isolation | Untrusted 3rd-party needing richer APIs | reserved (future) |

**Trust is default-deny.** Tier 0 (`node`, in-process) means *arbitrary code in
the host process* — the platform's single biggest risk surface. It is **reserved
for first-party and verified/enterprise-signed publishers**. Community / unverified
third-party plugins **default to T1 (`sandbox`) or T2 (`worker`)**; `node` is an
opt-in privilege unlocked only after publisher verification. The marketplace
enforces this at publish time (an unverified publisher cannot ship `runtime:
'node'`), not merely "may force" it at install.

### 3.7 Security model (reuses existing components)

- **Signing.** `PluginMetadata.signature` exists. Publisher signs; marketplace
  counter-signs on approval. Host ships trusted root keys; verify the chain at
  install (§3.5 step 4) **and** at load (§3.5 step 7).
- **Permissions.** New manifest `permissions` block → install-time consent →
  granted set → `PluginPermissionEnforcer` (service/hook/file/network already
  enforced). Principle of least privilege; all denials logged (existing
  behavior).
- **Config.** `PluginConfigValidator` validates plugin config against the
  `configuration` schema.
- **Supply chain.** Lockfile + per-file `integrity`; server-side scan for
  secrets and known-vuln deps; SBOM stored on the version row; **always**
  `--ignore-scripts` (no `postinstall`).
- **Reversible disable.** Reuse the package enable/disable + disable-state-store
  (ADR-0016 §9.5/§9.7): disabling a plugin stops loading its code and unregisters
  its contributions on next boot.

### 3.8 Versioning & lifecycle

Reuse the `sys_*` shape:

| Concern | Artifact |
|---|---|
| Plugin identity | `sys_plugin` (reverse-domain id, owner org, `marketplace_listed`) |
| Immutable version | `sys_plugin_version` (semver, checksum, signature, `permissions`, `engines`, SBOM, blob pointer, `status`) |
| Install state | `sys_plugin_installation` (`env_id`, `version_id`, `granted_permissions`, `is_preview`, `status`) |

Compatibility is gated **protocol-first** (per §3.10 #3): the host checks that it
provides every `capabilities.implements[].protocol` at a compatible version, then
falls back to `engines.platform`/`engines.protocol` ranges as a secondary guard.
This is more stable than platform semver and reuses the existing capability
declaration. Support deprecate/yank. **Update** = install the new version
side-by-side, swap the installation pointer; if the new version **widens
permissions** (services, hooks, network hosts, or RLS scopes — §3.10 #4), require
re-consent before activation.

### 3.9 Composition with metadata packages (unification)

A plugin may also ship declarative metadata via `contributes`. Install is then a
**superset**: hot-register the JSON *and* load the code + grant permissions. A
pure-element package is the degenerate plugin — `dist` empty, `permissions`
empty — so it falls straight back onto today's simple JSON path. One install
pipeline, two ends of a spectrum.

### 3.10 Refinements from scenario review (2026-06-01)

A pass over *what the marketplace must actually carry* (vertical apps, templates,
drivers, connectors, AI extensions, auth, automation, governance, UI widgets)
yielded a sharper model and six corrections.

**Three artifact layers, not two.** The metadata/code split is really a spectrum:

| Layer | Form | Install trust decision | Channel |
|---|---|---|---|
| **L0 declarative** | objects/views/flows/dashboards/permissions/themes/translations JSON | none (it is data) | existing JSON hot-register |
| **L1 declarative + sandboxed script** | JSON carrying L1 expression / L2 `ScriptBody` (validations, formulas, small automations) | "scripts allowed" only; runs in the existing QuickJS sandbox | JSON flow — **no `.osplugin`** |
| **L2 code plugin** | real npm deps + host APIs (drivers, connectors, AI, auth, …) | explicit permission consent + signature | `.osplugin` (this ADR) |

Recognizing **L1** explicitly means most "custom logic" (the bulk of what users
think needs code) rides the simple JSON flow + sandbox and never touches the
heavy code-plugin pipeline. This *strengthens* the §3.9 superset/spectrum claim.

**The six corrections:**

1. **Default-deny trust (see §3.6).** T0 in-process is reserved for first-party /
   verified publishers; third-party defaults to T1/T2; enforced at publish.
2. **Externalize `@objectstack/*` (see §3.3).** Host runtime is a peer-dep
   singleton; bundling it forks the engine.
3. **Protocol-first compatibility (see §3.8).** Gate primarily on the
   `capabilities.implements[].protocol` version the host provides (e.g.
   `storage.protocol.v1`), with `engines.platform` as a secondary guard —
   protocols are stable across platform major versions, semver is not.
4. **Permissions compose with RLS.** The coarse service/hook/file/network gate is
   necessary but not sufficient for connectors. Data-affecting permissions
   (which objects/fields a plugin may read/write, which OAuth scopes, which
   external hosts) must compose with the platform's object/field-level security
   (`plugin-security` / RLS), not be a parallel coarse gate. The granted set in
   `sys_plugin_installation` therefore references RLS scopes, not just service
   names.
5. **Secrets never ship in the artifact.** Connectors need credentials
   (API keys, OAuth tokens). The `.osplugin` must not carry secrets; the
   `configuration` schema marks secret fields, and install wires them to the
   platform settings / KV secret store (ADR-0007) via secret-refs. The plugin
   reads them through `PluginContext`, gated by the network/service permission.
6. **Connectors span declarative + code.** With ADR-0023 (OpenAPI→connector) and
   ADR-0024 (MCP connectors), any integration describable by OpenAPI/MCP is a
   **declarative connector config** (closer to L0/L1); only integrations needing
   custom auth, pagination, or streaming fall to an L2 code plugin. The connector
   catalog is therefore not monolithically "code plugins."

**Client-side UI plugins** (field renderers, view types, widgets) are a real
marketplace need this ADR does **not** cover — they load in the browser and need
a module-federation / iframe-sandbox model. Split to **ADR-0026**.

### 3.11 Audience & relation to ADR-0019 (consumer surface)

ADR-0019 makes the **App** the *only* consumer-facing unit: a consumer browses,
installs, opens, and uninstalls an **App** (`type: app`), and **internal
contributions** — `plugin`, `driver`, `server`, `ui`, `theme`, `agent`, … — are
*never* independently installed by a consumer (`isConsumerInstallable` filters the
consumer Marketplace to `type: app`). This ADR must not be read as "consumers
install plugins from a marketplace." It is reconciled as follows:

1. **Audience = developers / operators / ISVs, not end consumers.** The
   `.osplugin` pipeline is the **supply-side mechanism** for code-bearing
   contributions. A plugin reaches a tenant by exactly the two ADR-0019 routes:
   - **Bundled into an App** — the App author lists plugins as internal
     contributions (`plugins: [...]` in `defineStack`, per
     `docs/design/marketplace-publishing.md` §6.1); the consumer installs the App
     and the bundled plugins ride inside it. The `.osplugin` is then a **build-time
     dependency** the App author composes, signed and version-pinned.
   - **Operator-provisioned** — a platform operator/admin installs a plugin into a
     runtime/environment out-of-band (drivers, auth providers, observability
     exporters, connectors). This is the `os plugin install` / control-plane path
     in §3.4–§3.5, performed by an operator with the permission-consent step,
     **not** surfaced in the consumer App Marketplace.

2. **Two catalogs, one backbone.** The browsable listing built in §3.4 is a
   **developer/operator contribution catalog** (drivers, connectors, AI
   extensions, …), distinct from the consumer **App Marketplace** of ADR-0019 D2.
   Both reuse the same `sys_*` registry, signing, and artifact storage; they
   differ only in *who* may install and *which* `type`s each surface lists. The
   consumer App Marketplace stays `type: app`-only (ADR-0019 D2, enforced in
   `MarketplaceListingSchema.packageType`); the contribution catalog lists the
   internal `type`s and is reachable by operators/developers.

3. **This ADR is the gate ADR-0019 deferred.** ADR-0019 §Out-of-scope explicitly
   parks a *self-serve, consumer-facing, code-bearing* marketplace as a separate
   gated bet, and names its load-bearing wall: "**the L2 hook sandbox +
   capability/permission enforcer** … *this* — not review, not a purity rule — is
   the load-bearing wall, and its hardness must be proven first." ADR-0025's
   default-deny tiers (§3.6: T1 QuickJS sandbox, T2 out-of-process) + the
   permission-consent flow (§3.5) + RLS composition (§3.10 #4) **are exactly that
   wall.** So this ADR does not *open* the self-serve-consumer gate; it builds and
   hardens the mechanism that a future go/no-go could open the gate *on top of*.
   Until that decision, the pipeline serves developers and operators only.

In short: ADR-0019 governs **what a consumer sees** (only Apps); ADR-0025 governs
**how code contributions are built, signed, distributed, and safely loaded** for
the developers and operators who compose Apps and provision runtimes.

## 4. Phasing

- **Phase 1 — Artifact & build.** Define `.osplugin` + `objectstack.plugin.json`
  (`permissions`/`engines`/`runtime` Zod schema in `@objectstack/spec/system`);
  `os plugin build` (bundled strategy only); per-file integrity.
- **Phase 2 — Local install.** `os plugin install ./x.osplugin` + Studio upload
  → `marketplace/install-local`-style endpoint; materialize; `sys_plugin_*`
  rows + disable-state persistence; T0 in-process load with permission consent.
- **Phase 3 — Signing & registry.** Publisher signing + verification; `POST
  /cloud/plugins` + `/versions` (blob storage); marketplace listing + permission
  disclosure UI; server-side scans + counter-signing.
- **Phase 4 — Sandbox tier.** T1 `sandbox` runtime for script plugins via
  QuickJS; marketplace tier enforcement for unverified publishers.
- **Phase 5 — manifest-deps & T2.** Opt-in `manifest-deps` packaging
  (`pnpm install --ignore-scripts`); reserve and prototype out-of-process T2.

## 5. Consequences

### Positive

- Closes the distribution gap for code plugins while **reusing** the kernel
  loader, permission enforcer, QuickJS sandbox, and `sys_*` schema family.
- Bundled-default keeps install nearly as simple as the JSON flow (unpack +
  verify, no npm).
- Explicit permission consent makes the new trust boundary visible and
  auditable rather than implicit.
- Unifies packages and plugins under one marketplace and one install superset.

### Negative

- Introduces a binary artifact + blob storage + signing/key management the
  JSON-only flow never needed.
- Permission consent + tiering add UX and lifecycle surface (re-consent on
  permission widening, tier enforcement).
- Bundled packaging excludes native addons by default (mitigated by the opt-in
  manifest-deps strategy in Phase 5).

### Neutral

- The metadata-only JSON flow is unchanged and becomes the degenerate case.
- Local-first install mirrors ADR-0016 §9; cloud publish layers on top.

## 6. Alternatives considered

1. **Distribute plugins as plain npm packages installed via `npm i`.** Rejected:
   no signing, no permission consent, no `engines`/protocol gating, arbitrary
   `postinstall` scripts — the trust boundary is wide open and install depends on
   a registry + toolchain on every host.
2. **Ship raw source and build on the host at install.** Rejected: slow,
   non-deterministic, requires a full toolchain per host, and complicates
   integrity/signing.
3. **A second, parallel plugin registry separate from packages.** Rejected:
   forks the marketplace UX and the `sys_*` schema; the superset/degenerate-case
   model keeps one pipeline.
4. **Always sandbox (no T0 in-process tier).** Rejected for v1: first-party and
   verified plugins need full host APIs and performance; tiering lets policy, not
   architecture, decide the privilege level.

## 7. Open questions

- **Key management & rotation.** Where do publisher keys live, and how are root
  keys rotated/revoked on the host?
- **Permission widening UX.** Auto-disable on update until re-consent, or run
  with the old grant until an admin approves?
- **Hot vs boot activation.** Which plugin types are safe to hot-load
  (`hotReloadable`) vs require a restart to fully (un)register contributions?
- **T2 RPC surface.** What is the minimal host-service RPC contract an
  out-of-process plugin gets, and how does the enforcer mediate it?
- **Cross-plugin dependency conflicts.** How are diamond dependencies / version
  conflicts in plugin `requires` resolved at install time?

## 8. References

- [ADR-0003](./0003-package-as-first-class-citizen.md) — Package + versioned releases
- [ADR-0004](./0004-cloud-multi-kernel.md) — Cloud multi-kernel
- [ADR-0010](./0010-metadata-protection-model.md) — L1/L2/L3 protection
- [ADR-0016](./0016-studio-package-authoring-and-publish.md) — Package authoring & publish; local export/import (§9)
- [ADR-0007](./0007-settings-manifest-and-kv-store.md) — Settings manifest + KV/secret store (§3.10 #5)
- [ADR-0022](./0022-connectors-vs-messaging-channels.md) / [ADR-0023](./0023-openapi-to-connector-generator.md) / [ADR-0024](./0024-mcp-connectors.md) — Connectors: declarative generation vs. code plugins (§3.10 #6)
- [ADR-0019](./0019-app-as-consumer-unit.md) — App is the only consumer-facing unit; internal contributions ship inside Apps or are operator-provisioned (§3.11); names the L2-sandbox + enforcer as the gate's load-bearing wall
- [ADR-0026](./0026-client-ui-plugin-distribution.md) — Client-side UI plugin distribution (browser module/sandbox)
- `docs/design/marketplace-publishing.md` — Marketplace publishing flow; App composition (§6) consuming bundled plugins
- `packages/spec/src/kernel/plugin.zod.ts` — `isConsumerInstallable` (consumer surface = `type: app`)
- `packages/plugins/plugin-security/` — RBAC/RLS; composes with plugin permissions (§3.10 #4)
- `packages/core/src/plugin-loader.ts` — plugin loading, lifecycle, health, signature
- `packages/core/src/types.ts` — `Plugin` (`init/start/destroy`) + `PluginContext`
- `packages/core/src/security/plugin-permission-enforcer.ts` — capability-based enforcement
- `packages/core/src/security/plugin-config-validator.ts` — config validation
- `packages/runtime/src/sandbox/quickjs-runner.ts` — QuickJS-WASM sandbox (T1)
- `packages/runtime/src/cloud/marketplace-install-local-plugin.ts` — local inline install (ADR-0016 §9)
- `packages/runtime/src/cloud/marketplace-proxy-plugin.ts` — marketplace browse proxy
- `packages/runtime/src/package-state-store.ts` — per-environment disable-state persistence
- `packages/cli/src/commands/package/publish.ts` — existing package publish pipeline
- `packages/plugins/driver-memory/objectstack.config.ts` — example plugin manifest (`ObjectStackManifest`)
