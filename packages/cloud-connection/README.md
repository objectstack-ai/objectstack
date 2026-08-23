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
  // NOT cloud-gated: BOTH features.marketplace and features.installLocal are
  // derived from what is actually mounted, not from this constructor call, so
  // a cloud-less runtime reports marketplace: false and installLocal: true on
  // its own — there is nothing here to keep in sync.
  // `installLocal: true` is therefore a CEILING, not a declaration: it is the
  // default, and it cannot make the flag report a route this runtime never
  // mounted. Pass `false` to hide the affordance on a box that could serve it;
  // omitting it entirely behaves the same as `true`.
  // `''` here, unlike its neighbor above, is correct as-is: this plugin does
  // NOT re-resolve controlPlaneUrl through resolveCloudUrl(), so '' means
  // "stay on this origin" rather than "unset" — do not "fix" it to 'off'.
  new RuntimeConfigPlugin({ controlPlaneUrl: '', singleEnvironment: true, installLocal: true }),
];
```

## SPA telemetry is denied unless a runtime grants it

`GET /api/v1/runtime/config` carries a `telemetry` block:

```json
{ "telemetry": { "allowClientErrorReporting": false } }
```

It is the Console's **post-build off switch**. Every telemetry knob in the SPA
is a build-time variable frozen into the bundle, so a build that opted in has
no other way to be turned off on a deployed host — and an air-gapped
deployment measurably shipped one that could not be (`cloud#1508`: 14 Sentry
envelopes per session carrying IP and User-Agent PII).

It is **denied by default on every posture**. Grant it explicitly:

```bash
OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENABLED=true   # or: new RuntimeConfigPlugin({ allowClientErrorReporting: true })
```

Three properties worth knowing before you build on it:

- **A permission, not a source.** The server supplies no DSN and cannot start
  telemetry for a build that carries none. `true` means only "this deployment
  does not object to the sink you were compiled with".
- **A runtime that declared its control plane off cannot grant it.**
  `OS_CLOUD_URL=off` (or `none` / `local` / `disabled`) refuses the grant and
  says so in the boot log, so an air-gapped box stays silent even if a hosted
  configuration is copied onto it.
- **Absence means denied.** An older runtime, a third-party host, a 404 or a
  failed fetch all read the same way. Consumers should use the reading that
  ships with the contract rather than writing their own:

```ts
import { isClientErrorReportingAllowed } from '@objectstack/cloud-connection';

// `payload` may be the parsed body, or undefined when the fetch failed.
if (buildTimeDsn && isClientErrorReportingAllowed(payload)) initErrorReporting();
```

## Boundary (open mechanism, closed intelligence)

This package is **mechanism**: proxying a catalog, installing into the local
kernel, performing an RFC 8628 device-code bind, and reporting flags to the
SPA. The **policy** stays server-side in whatever control plane you point it
at: org-catalog filtering, entitlements for paid packages, quotas, and plan
rules. Plan-derived feature flags are injected by the host via
`RuntimeConfigPluginConfig.resolvePlanFeatures`.

`OS_CLOUD_URL=off` disables every remote call; air-gapped installs keep
working via inline manifests handed to `install-local`, and the SPA telemetry
permission above cannot be granted.

See `docs/adr` in the cloud repository (ADR-0008) for the full architecture
decision.
