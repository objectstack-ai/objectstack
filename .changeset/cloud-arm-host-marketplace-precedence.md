---
'@objectstack/cli': patch
---

`serve`: the cloud-connected marketplace arm now leaves a host config's own marketplace and cloud plugins alone.

`objectstack serve` auto-wires `MarketplaceProxyPlugin`, `MarketplaceInstallLocalPlugin`, the same-origin cloud-connection surface and `RuntimeConfigPlugin` whenever a cloud URL resolves. Each of those four mounts is now guarded on whether the loaded host config already wired that surface — the same presence check the offline arm has carried since the install-local fix — so CLI auto-wiring is a fallback for hosts that wire nothing rather than a second opinion about a surface the host already composed.

No behaviour changes for any current deployment: `Kernel.use()` keys plugins by `plugin.name` and the host's registration runs after the CLI's, so the host's instance already won by ordering. What changes is that it now wins by rule instead of by the relative position of two blocks that never referenced each other, and the CLI stops constructing four plugins it was about to discard. It becomes visible the moment a host passes an argument the CLI cannot — a private control plane, a custom install `storageDir`, a credential path, white-label branding.
