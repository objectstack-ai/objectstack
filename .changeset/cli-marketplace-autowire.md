---
"@objectstack/cli": minor
---

feat(cli): auto-wire marketplace from `@objectstack/cloud-connection` when a cloud URL resolves

ADR-0006 Phase 4 removed the framework CLI's duplicate marketplace plugins (they lived in `@objectstack/runtime`, duplicating the cloud distribution's copies). ADR-0008 then open-sourced the canonical client into the Apache-2.0 `@objectstack/cloud-connection` package, so the CLI can wire it again without crossing the open-core boundary — there is no longer a cloud-only copy to duplicate.

`objectstack serve`/`dev`/`start` now mount `MarketplaceProxyPlugin` + `MarketplaceInstallLocalPlugin` + the same-origin cloud-connection surface + `RuntimeConfigPlugin` (single-env, `installLocal: true`) whenever `resolveCloudUrl()` is truthy. `OS_CLOUD_URL=off` (or unset) mounts nothing, preserving the vanilla marketplace-less `objectstack dev`. Skipped in runtime/host-kernel mode (the cloud `objectos-stack` wires its own proxy on the host kernel — detected via `ObjectOSEnvironmentPlugin`, mirroring the existing AuthPlugin guard).

Fixes `objectstack start` empty-boot, which advertised "boot an empty kernel against your marketplace" but — having no config or artifact to carry the wiring — actually mounted no marketplace at all. The plugins self-register their Setup nav bundles, so Browse Marketplace + Installed Apps reappear automatically.
