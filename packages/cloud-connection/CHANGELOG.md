# @objectstack/cloud-connection

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/runtime@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Minor Changes

- 08a11f7: RuntimeConfigPlugin: make the per-request `features` seam open-ended and plan-agnostic (open-core boundary, cloud ADR-0012).

  The framework now transports an opaque feature map: a host's policy hook may return ANY boolean feature keys and they pass through to the SPA verbatim — the framework no longer enumerates a distribution's commercial feature catalog. Adds `resolveFeatures` (plan-agnostic) and `RuntimeFeatureOverrides`; deprecates `resolvePlanFeatures` / `RuntimeConfigPlanFeatures` (still honoured for backward compatibility).

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Minor Changes

- 998c4e4: New package: `@objectstack/cloud-connection` — the open runtime-side client for an ObjectStack cloud control plane (ADR-0008 Phase 2). Carries the marketplace browse proxy, install-local, the `/api/v1/cloud-connection/*` surface (status, RFC 8628 device-code bind, org catalog, installed views, control-plane install), and `RuntimeConfigPlugin` with a `resolvePlanFeatures` policy seam (plan entitlements stay host-side). Canonical sources move here from the cloud distribution's `@objectstack/objectos-runtime`, which now re-exports them.
- b8e4232: Self-hosted binding becomes consumable (cloud ADR-0008 consumption side): `ConnectionCredentialStore` persists the one-time `oscc_` runtime bearer the bind flow returns (0600, env-local); all control-plane forwards fall back to it when no `OS_CLOUD_API_KEY` is set; new `POST /cloud-connection/unbind` revokes + clears; install-local's catalog fetch presents the credential so org/private packages resolve. The binding Setup UI ships WITH the plugin as SDUI metadata (`cloud_connection_settings` page + Setup-nav contribution, ADR-0029 K2) — the console only registers the `cloud-connection:panel` widget.
- 8950204: The Installed Apps page ships as metadata with `MarketplaceInstallLocalPlugin` (cloud ADR-0009 P2a): `marketplace_installed` page (page:header + `marketplace:installed-list` widget) and the Setup nav entry switches to `type:'page'`.
- 17ffc74: `LocalManifestSource` — the install-local disk ledger promoted to a first-class, exported desired-state owner for self-hosted runtimes (cloud ADR-0007 step ⑤). `MarketplaceInstallLocalPlugin` now delegates all ledger reads/writes to it; behavior unchanged. Also exports `InstalledManifestEntry` and `DEFAULT_INSTALLED_PACKAGES_DIR`.
- c802327: Marketplace Setup navigation is now plugin-owned (cloud ADR-0009): `MarketplaceProxyPlugin` carries the "Browse Marketplace" entry and `MarketplaceInstallLocalPlugin` carries "Installed Apps" — no plugin mounted (e.g. `OS_CLOUD_URL=off`), no entry, no dead page. The two entries are removed from `@objectstack/platform-objects`' setup-nav contributions (ADR-0029 K2 ownership handoff).
- 48051ff: Runtime-identity bind v2 (cloud ADR runtime-identity-binding): a self-hosted runtime binds like a device — no environment id required. `bind/start`/`bind/poll` work environment-less in `singleEnvironment` mode; the bind call carries a registration claim (`hostname`, `runtime_version`, and the stored `runtime_id` on re-bind) and the store persists the cloud-minted `runtime_id` (durable identity, stable across token rotations). `status` reports `runtimeId` and treats "no env id" as unbound rather than 404; `unbind` revokes bearer-first with no environment requirement; `org-packages` forwards bearer-only when no environment is configured (the connection carries the org); `installation`/`installed` degrade gracefully for registration-only runtimes. `StoredConnectionCredential.environmentId` is now optional (`runtimeId` added).

### Patch Changes

- 9fea621: bind/start appends device context (`runtime_name`, `runtime_version`) to the device-flow verification URLs so the cloud approval page can show WHAT is being authorized (ADR runtime-identity-binding §2.3). Display-only informed-consent context; the approval page pairs it with an "only approve if you started this" warning.
- 3786f15: install-local accepts compiled stack bundles: a published version payload (`dist/objectstack.json`) nests its meta under `.manifest` while ObjectQL's registerApp expects the flat app shape — every install of a published compiled bundle failed with "Invalid manifest payload". The handler now flattens the bundle shape (both the cloud-fetch and inline/file-import paths).
- 9b4e870: `resolveEnvironmentId` no longer presents the CLI's local-dev sentinel ids (`env_local` / `proj_local`) to the control plane as cloud environment ids — they identify the local kernel only. A single-environment runtime started via `objectstack dev` now reads as cleanly unbound and binds environment-less (ADR runtime-identity-binding), instead of 404-ing the bind against a non-existent cloud environment.
- d01c427: Unbind keeps an identity residual: the credential is cleared (and revoked cloud-side first) but `runtimeId` survives in the store, so a later re-bind to the same org claims — and revives — the same registration instead of minting a new device per disconnect cycle. `ConnectionCredentialStore.read()` accepts token-less residual records.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/types@9.3.0
