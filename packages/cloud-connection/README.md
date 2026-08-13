# @objectstack/cloud-connection

The runtime-side client for an ObjectStack cloud control plane (ADR-0008).

Connects any ObjectStack runtime — vanilla `objectstack dev`, a self-hosted
single-environment deployment, or a multi-tenant fleet — to a control plane
for package distribution. Capability progresses with binding:

| State | Capability | Plugin / routes |
|---|---|---|
| Unbound (anonymous) | Browse the public marketplace catalog | `MarketplaceProxyPlugin` → `/api/v1/marketplace/*` |
| Unbound (anonymous) | Install public packages into THIS runtime | `MarketplaceInstallLocalPlugin` → `/api/v1/marketplace/install-local` |
| Bound (device-code) | Status, bind, org catalog, installed views, control-plane installs | `CloudConnectionPlugin` → `/api/v1/cloud-connection/*` |
| Always | SPA feature discovery | `RuntimeConfigPlugin` → `/api/v1/runtime/config` |

## Usage

```ts
import {
  MarketplaceProxyPlugin,
  MarketplaceInstallLocalPlugin,
  CloudConnectionPlugin,
  RuntimeConfigPlugin,
  resolveCloudUrl,
} from '@objectstack/cloud-connection';

const cloudUrl = resolveCloudUrl(); // OS_CLOUD_URL, 'off' disables

const plugins = [
  // Cloud-gated: these ARE the control-plane client, so a resolved URL is
  // their precondition. Skipped entirely when cloud is off.
  ...(cloudUrl ? [
    new MarketplaceProxyPlugin({ controlPlaneUrl: cloudUrl }),
    new CloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: cloudUrl }),
  ] : []),
  // NOT cloud-gated: this is the documented air-gapped path, so it mounts
  // unconditionally. `cloudUrl || 'off'` — never the bare `cloudUrl` — because
  // the constructor re-resolves whatever it is given through
  // resolveCloudUrl(), which reads '' as "unset" and substitutes the public
  // DEFAULT_CLOUD_URL. 'off' is one of the documented disable sentinels and
  // is the value that actually resolves to no cloud.
  new MarketplaceInstallLocalPlugin({ controlPlaneUrl: cloudUrl || 'off' }),
  // NOT cloud-gated: features.marketplace is derived from what is actually
  // mounted, not from this constructor call, so a cloud-less runtime reports
  // marketplace: false on its own — there is nothing here to keep in sync.
  new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, installLocal: true }),
];
```

## Boundary (open mechanism, closed intelligence)

This package is **mechanism**: proxying a catalog, installing into the local
kernel, performing an RFC 8628 device-code bind, and reporting flags to the
SPA. The **policy** stays server-side in whatever control plane you point it
at: org-catalog filtering, entitlements for paid packages, quotas, and plan
rules. Plan-derived feature flags are injected by the host via
`RuntimeConfigPluginConfig.resolvePlanFeatures`.

`OS_CLOUD_URL=off` disables every remote call; air-gapped installs keep
working via inline manifests handed to `install-local`.

See `docs/adr` in the cloud repository (ADR-0008) for the full architecture
decision.
