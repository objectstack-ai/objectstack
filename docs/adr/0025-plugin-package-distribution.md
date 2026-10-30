# ADR-0025: Plugin Package Distribution (Code + Dependencies)

**Status**: Accepted — 2026-10-28 (ruled on objectstack#26553, ADR batch 4; proposed 2026-05, revised 2026-06-01, audited 2026-07-16 and 2026-09-12). Narrowed to what landed: Phase 1 (the `.osplugin` artifact, the compiled-manifest schema, `os plugin build` / `sign` / `publish`, cloud review and counter-signing), install-time permission consent for package installs (console disclosure, `sys_package_installation.granted_permissions`, re-consent on a widening upgrade, the artifact → enforcer binding at load), and M1, the local T0 install loop (2026-10-29, §3.5: `os plugin install ./x.osplugin` against the environment's trusted keys, the boot-time loader with the tier dispatch point, disable / enable / uninstall; its cloud-sample acceptance run is still open). Not yet built, carried by the M0–M3 programme on objectstack#27108: the cloud fetch of a code plugin (§3.5 — M2), runtime enforcement of the granted set (registered only today, §3.7 — M2), tier dispatch beyond `node` (T1 sandbox — M3), publish-side scans and secret-refs (M3). This revision (v2, 2026-10-28) corrects §3.3, §3.4, §3.8 and §3.10 to the code and records the maintainer's decisions Q1–Q8; amended 2026-10-30 to what M1 shipped (§3.2, §3.3, §3.4, §3.5, §3.6, §3.7, §5, §7, §8).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package + versioned releases), [ADR-0004](./0004-cloud-multi-kernel.md) (cloud multi-kernel), [ADR-0010](./0010-metadata-protection-model.md) (L1/L2/L3 protection), [ADR-0016](./0016-studio-package-authoring-and-publish.md) (package authoring & publish, local export/import)
**Consumers**: `@objectstack/core` (kernel, plugin-loader, security), `@objectstack/runtime` (sandbox, marketplace install), `@objectstack/cli`, `@objectstack/spec/system` (ObjectStackManifest), `@objectstack/spec/cloud`, `../objectui` (Studio)
**Related**: [ADR-0019](./0019-app-as-consumer-unit.md) (App is the only consumer-facing unit — this pipeline serves developers/operators, see §3.11), [ADR-0026](./0026-client-ui-plugin-distribution.md) (client-side UI plugins — out of scope here), [ADR-0007](./0007-settings-manifest-and-kv-store.md) (settings + secret store), [ADR-0022](./0022-connectors-vs-messaging-channels.md)/[ADR-0023](./0023-openapi-to-connector-generator.md)/[ADR-0024](./0024-mcp-connectors.md) (connectors)

---

> **Revision v2 (2026-10-28) — read with the status line.** A code inventory on
> objectstack `f2fdac5d7a` and cloud `ce05c91` (objectstack#27108) found the supply
> side built and the demand side absent, and four sections describing code that
> never existed in that form. v2 corrects them in place — **§3.3** (esbuild, not
> tsup; `manifest-deps` retired), **§3.4** (publish goes to `/cloud/packages`, the
> signature is an Ed25519 sidecar), **§3.8** (the `sys_plugin*` triple is folded
> into `sys_package*`), **§3.10** (L1 is live as script bodies) — and records the
> maintainer's decisions of 2026-10-28 (Q1–Q8, §4) that sequence the rest as
> M0–M3. Historical text is kept where it still states the design; corrected
> text is marked *v2*.
>
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

> **Path note (2026-09):** every `packages/runtime/src/cloud/…` path in this record is historical and
> deliberately unlinked — `packages/runtime/src/cloud/` was removed by ADR-0006 Phase 4 (`15fcd360d`, 2026-06-11), which took the cloud plugins out of the framework runtime.
> They are kept as written because they record where this decision landed at the time.

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
  `startupTimeout`), `packages/core/src/types.ts` (`Plugin`
  with `init/start/destroy` + `PluginContext`),
  `packages/core/src/security/plugin-permission-enforcer.ts`
  (capability-based service/hook/file/network enforcement),
  and `packages/runtime/src/sandbox/quickjs-runner.ts`
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
├── dist/index.mjs            # pre-built ESM bundle (esbuild, `@objectstack/*` external — v2)
├── package.json              # (retired with manifest-deps, v2 §3.3 — not shipped)
├── pnpm-lock.yaml            # (retired with manifest-deps, v2 §3.3 — not shipped)
├── assets/ README LICENSE icon
└── SIGNATURE                 # placeholder; the Ed25519 signature is the `.sig` sidecar (v2 §3.4)
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
  "packaging": "bundled",             // bundled, the one strategy  (see §3.3)
  "permissions": {                    // explicitly requested capabilities
    "services": ["object", "http"],
    "hooks": ["record.beforeInsert"],
    "network": ["api.acme.com"],
    "fs": []
  },
  "integrity": { "dist/index.mjs": "sha256-..." },  // per-file hashes
  "configuration": { /* config schema — validator retired, re-decide with this layer (§3.7) */ },
  "capabilities": { /* existing implements/provides/requires/contributes */ },
  "contributes": { /* OPTIONAL declarative metadata: objects/views/flows/... */ }
}
```

`permissions` is the one new protocol surface the runtime must understand at
install/load time; everything else is additive. `permissions` maps 1:1 onto the
checks the existing `PluginPermissionEnforcer` already implements
(`canAccessService`, `canTriggerHook`, `canReadFile/Write`, `canNetworkRequest`).

### 3.3 Packaging strategies (default: bundled)

- **Bundled (the one strategy, v2).** `os plugin build` bundles with **esbuild**
  (`packages/cli/src/commands/plugin/build.ts`) into `dist/index.mjs`, validating
  the manifest against `ManifestSchema` and writing per-file `integrity` into the
  compiled manifest. Install = unpack + verify; **no npm/toolchain at install
  time**. This is the closest analog to the JSON flow and keeps the security
  surface minimal. Native (`.node`) addons are disallowed by rule, and since M1
  `os plugin build` refuses one before writing anything (a `.node` module or a
  native package the bundle reaches, or a `.node` file under `assets/`).
- **manifest-deps — RETIRED (v2, maintainer decision Q6, 2026-10-28; ADR-0049
  enforce-or-remove).** The strategy existed on the build side only (it shipped
  `package.json` + `pnpm-lock.yaml` and nothing ever installed them); it had zero
  consumers and no install path. `PluginPackagingSchema` accepts `bundled` only
  and refuses `manifest-deps` by name with its migration prescription; the
  build-side half was removed in M1 (#27679). Plugins that need native
  addons or very large dependencies are a fresh decision for M3, with this
  retirement as the starting evidence.

**Externalize the host runtime.** `@objectstack/*` packages (`core`, `spec`, …)
are declared as **peerDependencies** and marked `external` in the bundle
(`build.ts`: `external = ['@objectstack/*']`) — the plugin binds to the **host's**
copy at load time. Bundling them would create a second engine/Zod instance inside
the plugin (duplicate registries, broken `instanceof`, double validation). Rule:
**bundle third-party libs, externalize `@objectstack/*` (host-provided
singletons)**. Version compatibility of these peers is gated by §3.8.

### 3.4 Build → sign → publish pipeline

```
os plugin build  →  os plugin sign  →  os plugin publish
```

*v2 — as built (`packages/cli/src/commands/plugin/`, `packages/core/src/security/plugin-artifact-signature.ts`, cloud `packages/service-cloud/src/routes/package-publish.ts` / `package-review.ts`):*

1. **build** — validate the manifest (`ManifestSchema`: `permissions`, `engines`,
   `runtime`, `packaging`, `integrity`); bundle with esbuild (§3.3); compute
   per-file SRI hashes (`sha256-<base64>`, `cli/src/utils/osplugin.ts`); emit
   `<id>-<version>.osplugin` (ustar + gzip) with a placeholder `SIGNATURE` entry.
2. **sign** — Ed25519 over the raw artifact bytes, written as
   `ed25519:<keyId>:<base64url>` to a `.sig` sidecar (`sign.ts`); the publisher
   key stays with the publisher. Since M1 the host verifies it against the
   environment's trusted keys (§7) at `os plugin install` and again at every boot
   (`verifyPluginArtifact`); `plugin-loader.ts` refuses a signature no host verified.
3. **publish** — extends `os package publish` and **reuses the package registry**
   (the `/cloud/plugins` endpoints of the original text were never built):
   - `POST /cloud/packages` → ensure the `sys_package` row (reverse-domain `id`,
     owner org);
   - `POST /cloud/packages/:id/versions` with `artifact_kind: 'plugin'` → the
     cloud verifies the whole-artifact sha256 and the publisher signature, runs
     the permission / tier audit (`plugin-permission-audit.ts`: an unverified
     publisher may not ship `runtime: 'node'`, 422 + manual review), and stores
     the blob opaquely at `packages/<org>/<pkg>/<version>.osplugin`
     (`plugin-artifact-store.ts`) with manifest, `permissions`, `integrity`,
     `signature`, `engines`, size and SBOM on `sys_package_version` (§3.8),
     `status: pending_review → published`;
   - **review** — submit / approve / reject / withdraw (`package-review.ts`);
     approval **counter-signs** with the platform key (`platform_signature`).
   - **Not built (M3):** server-side secret / malware / known-vulnerability scans;
     per-file integrity re-verification on the server (the server checks the
     whole-artifact hash and does not unpack).
   - `marketplace_listed` reuses ADR-0016's catalog model; the console shows a
     "contains code" badge and the permission-disclosure panel (§3.5 step 3).

The registry therefore stores **both** the browsable JSON metadata (unified
marketplace UX with packages) **and** the binary artifact blob. What it does not
yet do is **serve the blob back**: `GET /marketplace/packages/:id/versions/:vid/artifact`
returns the manifest JSON, not the `.osplugin` — the download route is M2.

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
   `<OS_HOME>/plugins/<env>/<id>/<version>/`. *v2:* nothing is installed there;
   `bundled` is the one strategy (§3.3), so install runs no package manager.
6. **Register.** Write the installation record — `sys_package_installation`
   (`env_id`, `version_id`, `granted_permissions`, `status`; v2 §3.8, the
   `sys_plugin_installation` of the original text was never created). Persist to a local store so installs survive
   restarts (reuse the ADR-0016 §9.7 `package-state-store.ts` pattern).
7. **Load + activate.** On next boot (*v2:* boot only, `hotReloadable` retired), the loader
   scans installed plugins, dynamic-imports the entry, wraps `PluginContext`
   with the enforcer scoped to the granted set, and runs `init → start` in
   dependency order. If the plugin also has `contributes` metadata, that JSON is
   hot-registered exactly like a pure-element package.

**Local-first parity.** `os plugin install ./foo.osplugin` and a Studio "Install
plugin" upload both hit a `marketplace/install-local`-style endpoint (inline
artifact, register-before-persist per ADR-0016 §9.3). Local artifacts need no
cloud account; signature verification is still performed (publisher key or an
explicit `--trust-unsigned` dev override). *v2 — as built in M1:* no endpoint and
no Studio upload; `os plugin install` is a CLI act at the host that persists at
install (under `OS_HOME`) and registers the plugin at the next boot.

*v2 — where the flow stands and how it lands (maintainer decisions Q1–Q2, 2026-10-28):*

- **Steps 1–3 are live for package installs** on the cloud control plane and the
  console: resolve / compatibility on `sys_package_version`, the
  `PluginDisclosure` panel that blocks Install until the admin acknowledges a
  code-bearing package, `sys_package_installation.granted_permissions`, and a
  409 `PERMISSION_RECONSENT_REQUIRED` on a widening upgrade. The granted set
  always equals the declared set — there is no partial grant.
- **Steps 4–7 exist for a local artifact only** (M1, below; step 7's per-plugin
  enforcer is M2, §3.7). For a code plugin in the cloud they do not: nothing
  serves the `.osplugin` back (§3.4), and an environment artifact carries
  `sys_package_version.manifest_json` — metadata only, never the blob.
- ✅ **M1 — local T0 loop, first-party / self-signed only — landed 2026-10-29**
  (objectstack#27123: #27335, #27374, #27679). `os plugin install ./x.osplugin`
  verifies the `.sig` over the raw bytes against the environment's trusted keys
  (§7) before inflating anything, re-verifies every file against `integrity`,
  materializes to `<OS_HOME>/plugins/<env>/<id>/<version>/` and records the
  install in a local store (the stand-in for the §3.8 row); `--trust-unsigned`
  admits only an unsigned artifact, loudly. At **boot** (hot reload was retired
  with #12587) `os serve` re-verifies each install (artifact sha, signature,
  byte-equal tree), dispatches on the tier (§3.6) and hands what passed to
  `kernel.use`, which orders dependencies. `os plugin disable` / `enable` use the
  package disable-state store; `uninstall` takes effect at the next boot. Still
  open: the acceptance run on the cloud `plugins/connector-stripe` sample
  (objectstack#27570).
  ⛔ **M1 is first-party / self-signed only and is listed on no marketplace
  surface**: T0 is author code in the host process (§3.6).
- **M2 — cloud fetch**: the artifact download route serves the `.osplugin` with
  publisher + platform signatures; `os plugin install <id>@<version>` walks
  resolve → compat → consent → download → the M1 path. M2 also lands the
  per-plugin enforcement of §3.7.

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

*v2 — as built and as phased (maintainer decision Q3):* `PluginRuntimeSchema`
holds the three values, the cloud refuses `node` from an unverified publisher at
publish, and since M1 the boot-time loader dispatches on an installed plugin's
tier (`dispatchPluginRuntime`): `node` is imported in process, `sandbox` /
`worker` and an undeclared tier are refused by name — every plugin that loads
today loads in-process. The QuickJS runner serves hook / action script
bodies (§3.10 L1) and is never reached from a plugin's declared tier;
`PluginSandboxRuntime` has no production construction site; T2 has no code.
M1 wired the dispatch point for T0 only; **M3** routes `runtime: 'sandbox'` to
QuickJS and decides the T2 RPC surface (§7). Until M3 nothing loads isolated
(those tiers are refused, not confined), which is why M1 stays first-party /
self-signed.

### 3.7 Security model (reuses existing components)

- **Signing.** `PluginMetadata.signature` exists. Publisher signs; marketplace
  counter-signs on approval. Host ships trusted root keys; verify the chain at
  install (§3.5 step 4) **and** at load (§3.5 step 7).
- **Permissions.** New manifest `permissions` block → install-time consent →
  granted set → `PluginPermissionEnforcer`. Principle of least privilege; all
  denials logged.

  > **Landed as far as REGISTRATION, and no further (2026-09-12, #17147).** The
  > parenthetical here used to read *"(service/hook/file/network already
  > enforced)"*. It was never true of the granted set, and two of the four
  > classes have no enforcement surface at all. Measured on `9bd4344e4`:
  >
  > - the consent record is persisted by the control plane
  >   (`sys_package_installation.granted_permissions`) and re-consent is forced
  >   on a widening upgrade — **live**, §3.8 as written;
  > - it reaches the runtime on `EnvironmentArtifactSchema.grantedPermissions`
  >   and `AppPlugin.init()` hands each entry to
  >   `PluginPermissionEnforcer.registerGrantedPermissions` — **live** (#13457);
  > - **nothing queries that registry.** `enforceServiceAccess` and
  >   `enforceHookTrigger` are reachable only through `SecurePluginContext`,
  >   which has zero production construction sites; `enforceFileRead`,
  >   `enforceFileWrite` and `enforceNetworkRequest` are called by nothing at
  >   all, `SecurePluginContext` included.
  >
  > ⇒ the granted set records what was consented to and **refuses no
  > operation**. Per-plugin context construction — §3.5 step 7's *"wraps
  > `PluginContext` with the enforcer scoped to the granted set"* — is the
  > materialize seam that maintainer ruling `5486840233` assigns to this ADR's
  > install-flow design work and forbids improvising elsewhere; it is tracked as
  > **#17147** and is not built. The measurement is pinned in
  > `packages/core/src/security/granted-permissions-not-enforced.pin.test.ts`,
  > which goes red the day it is — delete this note in that PR.
- **Config.** RETIRED 2026-08-27 (#11982, ADR-0049 enforce-or-remove;
  maintainer ruling, decision-inbox batch 5). `PluginConfigValidator` /
  `createPluginConfigValidator` and `PluginMetadata.configSchema` were removed:
  the mechanism could never run — the loader's one call site passed no config,
  no manifest→`loadPlugin` path existed to carry one, `PluginMetadata` had no
  config-value field, and zero plugins declared a schema (measured with
  positive controls on #11982; the sibling `hotReloadable` fell to the same
  measurement in #12587). Re-declaring a kernel-owned config-validation
  surface is a **fresh decision** for the day this distribution layer actually
  lands, with #11982's zero-caller measurement as its starting evidence — the
  manifest `configuration` block below records the design intent, not a live
  validator.
- **Supply chain.** Per-file `integrity`; server-side scan for secrets and
  known-vuln deps; SBOM stored on the version row; **always** `--ignore-scripts`
  (no `postinstall`). *v2:* no lockfile ships (bundled only, §3.3), so install
  runs no package manager at all; `integrity` is re-verified at install and at
  every boot (M1); the scans are M3 (§3.4).
- **Reversible disable.** Reuse the package enable/disable + disable-state-store
  (ADR-0016 §9.5/§9.7): disabling a plugin stops loading its code and unregisters
  its contributions on next boot.

*v2 — phasing of the permission gate (maintainer decision Q4, 2026-10-28):* the
registration note above is still accurate on `f2fdac5d7a` (`new
SecurePluginContext(` appears only in tests; `enforceFileRead` /
`enforceFileWrite` / `enforceNetworkRequest` have no callers). **M2** builds the
per-plugin `SecurePluginContext` scoped to the granted set for **services and
hooks**, deletes `granted-permissions-not-enforced.pin.test.ts` and the
"the runtime does not yet restrict" sentence in `PluginDisclosure.tsx` in the
same PR, and lands before any third-party load. The **`fs` and `network`
classes keep their schema** and get their own enforce-or-remove decision in
**M3** — today they have no production call surface at all, so neither
"enforced" nor "removed" can be said truthfully yet. §3.10 #4 (RLS-scoped
grants) stays a design note; §3.10 #5 (secret-refs) lands with the first real
connector in M3 (Q7).

### 3.8 Versioning & lifecycle

*v2 — the registry is `sys_package*`, not a `sys_plugin*` triple (maintainer
decision Q5, 2026-10-28; cloud `packages/service-tenant/src/objects/`):*

| Concern | Artifact (as built) |
|---|---|
| Plugin identity | `sys_package` (reverse-domain id, owner org, `visibility`, `marketplace_listed`) — a plugin is a package with `artifact_kind: 'plugin'` |
| Immutable version | `sys_package_version` (`artifact_kind`, `packaging`, `runtime`, `engines`, `permissions`, `integrity`, `sbom`, `signature`, `platform_signature`, `blob_key`, size, `status`) |
| Install state | `sys_package_installation` (`env_id`, `version_id`, `granted_permissions`, `status`) — the consent record, re-consent on widening |

The original text's `sys_plugin` / `sys_plugin_version` / `sys_plugin_installation`
were never created; the fold is the §3.9 superset made literal, and it is kept.
Side-by-side versions and `yank` are not built (M2).

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
| **L1 declarative + sandboxed script** | JSON carrying L1 expression / L2 `ScriptBody` (validations, formulas, small automations) | "scripts allowed" only; runs in the existing QuickJS sandbox (**live** — hook / action script bodies, `packages/runtime/src/sandbox/quickjs-runner.ts`; v2) | JSON flow — **no `.osplugin`** |
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
   `sys_package_installation` (v2 §3.8) therefore references RLS scopes, not just service
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

*v2 (2026-10-28) — the original Phases 1–5 are replaced by the M0–M3 programme the
maintainer ruled on objectstack#26553 and that objectstack#27108 carries. The
maintainer's decisions, recorded verbatim on the epic:*

| # | Question | Decision |
|---|---|---|
| Q1 | first consumer | first-party drivers / connectors (T0, self-signed); the cloud `plugins/connector-stripe` sample is the acceptance case; third parties wait for M3 |
| Q2 | local-first | `os plugin install ./x.osplugin` before the cloud fetch (ADR-0016 §9 parity) |
| Q3 | trust tier | T0 only in M1, with the tier dispatch point kept for T1 in M3 |
| Q4 | enforcement | per-plugin `SecurePluginContext` in M2, before any third-party load; services + hooks enforced; `fs` / `network` decided in M3 |
| Q5 | registry | the `sys_package*` fold accepted (§3.8) |
| Q6 | dependencies | `manifest-deps` dropped; bundled only (§3.3) |
| Q7 | §3.10 #4 / #5 | secret-refs only, at the first real connector (M3); RLS-scoped grants stay a design note |
| Q8 | §7 open questions | widening UX = the shipped 409 re-consent; boot activation (hot reload retired, #12587); key rotation, T2 RPC and dependency conflicts deferred to M3 |

- **M0 — this record, v2.** The four corrected sections, the decisions above, the
  §3.5 split; status line set. (objectstack#27110)
- **M1 — local T0 install loop** (first-party, self-signed; `cli` + `server`
  lanes): §3.5 M1 bullet; the manifest-deps build half removed; the native-addon
  refusal; the code's own "no `os plugin install`" / "NOT RE-VERIFIED AT UNPACK"
  self-descriptions deleted as each lands. Acceptance: the Stripe sample.
- **M2 — cloud fetch + enforcement** (`cloud` + `server`): the artifact download
  route, `os plugin install <id>@<version>`, per-plugin `SecurePluginContext`
  (services, hooks), side-by-side versions / yank; the enforcement pin test and
  the disclosure sentence deleted in the same PR.
- **M3 — third-party tier** (`cloud` + `server` + `spec`): T1 dispatch to QuickJS,
  publish-side scans, secret-refs to the settings / KV store (ADR-0007), the
  `fs` / `network` enforce-or-remove decision, the three deferred §7 answers. T2
  stays reserved.

*Mapping to the original phases:* Phase 1 (artifact & build) is done; Phase 2
(local install) = M1; Phase 3 (signing & registry) is done on the publish side and
its download / scan half is M2 / M3; Phase 4 (sandbox tier) = M3; Phase 5
(manifest-deps & T2) is retired (Q6) and reserved respectively.

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
- Bundled packaging excludes native addons, and `os plugin build` refuses them;
  with manifest-deps retired (Q6), a plugin that needs one waits for M3 (§3.3).

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

*v2 (maintainer decision Q8, 2026-10-28): answered, or deferred to a named milestone.*

- **Permission widening UX** — **answered, as shipped**: an upgrade that widens
  the declared permissions returns 409 `PERMISSION_RECONSENT_REQUIRED` and is not
  activated until an admin re-consents (cloud `install.ts`).
- **Hot vs boot activation** — **answered**: boot activation only; `hotReloadable`
  was retired under ADR-0049 (#12587). A plugin (un)registers its contributions
  on the next boot.
- **Key management & rotation** — deferred to **M3** (publisher keys stay with the
  publisher; the host's trusted root set and its rotation / revocation are
  designed with the T1 tier). *Note (2026-10-30, ruling `6467932167` on
  objectstack#27123, letter B′):* the host's trusted-key **store** landed in M1
  in its minimal form — `sys_trusted_key` (public keys only, `source: 'local'`),
  `os plugin keygen` and `os plugin trust add | list | revoke`; install and boot
  refuse an unknown or revoked key id by name. Rotation policy stays M3; the
  `platform` / `cloud` values of `source` are reserved for the keys M2 / M3 cache
  from the platform chain (M2's `cloud` rows: root key → platform
  counter-signature → publisher key).
- **T2 RPC surface** — deferred to **M3** (T2 stays reserved; the minimal
  host-service RPC contract is designed when the sandbox tier lands).
- **Cross-plugin dependency conflicts** — deferred to **M3** (M1 and M2 install
  first-party plugins whose `requires` closure is small; diamond resolution is
  designed with the third-party tier).

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
- `packages/core/src/security/granted-permissions-not-enforced.pin.test.ts` — the registered-not-enforced measurement pin (deleted by M2)
- `packages/core/src/security/plugin-artifact-signature.ts` — Ed25519 sign / verify / counter-sign (v2 §3.4)
- `packages/cli/src/commands/plugin/{build,sign,publish}.ts`, `packages/cli/src/utils/osplugin.ts` — the Phase 1 pipeline as built (v2 §3.3–3.4)
- `packages/cli/src/commands/plugin/{install,keygen,disable,enable,uninstall}.ts`, `packages/cli/src/commands/plugin/trust/{add,list,revoke}.ts` — the M1 install loop and the trusted-key commands (v2 §3.5, §7)
- `packages/runtime/src/installed-plugin-loader.ts`, `packages/runtime/src/plugin-installation-store.ts`, `packages/cli/src/utils/installed-plugins-boot.ts` — the boot-time loader with the tier dispatch point, the local installation records, and `os serve`'s registration of what passed (v2 §3.5, §3.6)
- `packages/core/src/security/plugin-artifact-verdict.ts` — the host's verdict `plugin-loader.ts` reads before it accepts a `signature` (v2 §3.4)
- `packages/platform-objects/src/system/sys-trusted-key.object.ts` — `sys_trusted_key`, the environment's trusted publisher public keys (v2 §7)
- `packages/runtime/src/security/artifact-granted-permissions.ts` — the artifact → enforcer binding at load (v2 §3.7)
- `packages/spec/src/kernel/manifest.zod.ts` — `PluginPermissionsSchema`, `PluginEnginesSchema`, `PluginRuntimeSchema`, `PluginPackagingSchema`, `PluginIntegritySchema` (v2 §3.2)
- objectstack#27108 — the M0–M3 programme (v2 §4)
- `packages/runtime/src/sandbox/quickjs-runner.ts` — QuickJS-WASM sandbox (T1)
- `packages/runtime/src/cloud/marketplace-install-local-plugin.ts` — local inline install (ADR-0016 §9)
- `packages/runtime/src/cloud/marketplace-proxy-plugin.ts` — marketplace browse proxy
  *(Path note, 2026-09: both `marketplace-install-local-plugin.ts` and `marketplace-proxy-plugin.ts`
  are historical and deliberately unlinked — `packages/runtime/src/cloud/` was removed by ADR-0006
  Phase 4, `15fcd360d`, 2026-06-11.)*
- `packages/runtime/src/package-state-store.ts` — per-environment disable-state persistence
- `packages/cli/src/commands/package/publish.ts` — existing package publish pipeline
- `packages/drivers/driver-memory/objectstack.config.ts` — example plugin manifest (`ObjectStackManifest`)
