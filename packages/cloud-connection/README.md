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

## The Console's error-reporting sink is served by this runtime

`GET /api/v1/runtime/config` carries a `telemetry` block. Unconfigured, it is
empty — which is what a deployment that never asked for error reporting serves:

```json
{ "telemetry": {} }
```

Configure a sink and the block carries it, together with the closed set of
knobs that must travel with it:

```json
{
  "telemetry": {
    "errorReporting": {
      "dsn": "https://PUBLIC_KEY@o1.ingest.sentry.io/42",
      "sendDefaultPii": false,
      "environment": "production",
      "tracesSampleRate": 0.1,
      "replaysOnErrorSampleRate": 0
    }
  }
}
```

Everything is set on the **runtime**, in one place, with no frontend rebuild —
which is the point: ObjectStack's users consume a prebuilt Console and cannot
set build-time keys.

```bash
OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN=https://PUBLIC_KEY@o1.ingest.sentry.io/42
OS_TELEMETRY_CLIENT_ERROR_REPORTING_SEND_DEFAULT_PII=true     # IP + User-Agent, off by default
OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENVIRONMENT=production
OS_TELEMETRY_CLIENT_ERROR_REPORTING_TRACES_SAMPLE_RATE=0.1
OS_TELEMETRY_CLIENT_ERROR_REPORTING_REPLAY_SAMPLE_RATE=0
```

…or, from a host that composes the plugin directly:

```ts
new RuntimeConfigPlugin({ clientErrorReporting: { dsn: 'https://PUBLIC_KEY@…/42' } })
```

An explicit option wins over the matching env var, **per field** — a host that
sets only `sendDefaultPii` does not discard the operator's DSN.

Four properties worth knowing before you build on it:

- **The DSN's presence IS the grant.** There is no separate permission boolean
  (the one that shipped in #10805 was removed by #12681, not paralleled). A
  runtime that serves a DSN is asking for reports; a runtime that serves none
  is not. Two knobs in two places had two silent dead states — "permission on,
  no DSN" and "DSN in, permission off" — that look identical from the browser.
- **A runtime that declared its control plane off serves no sink.**
  `OS_CLOUD_URL=off` (or `none` / `local` / `disabled`) refuses the DSN and says
  so in the boot log, so an air-gapped box stays silent even if a hosted
  configuration is copied onto it.
- **Malformed is refused at mount, never coerced.** A DSN that is not an
  `https://PUBLIC_KEY@HOST/PROJECT_ID` URL is refused and named in the boot log,
  and so is one carrying a **secret** after the public key — this payload is read
  by every browser that loads the Console. A bad sample rate falls back to its
  default rather than taking the sink down with it.
- **Absence means no reporting.** An older runtime, a third-party host, a 404 or
  a failed fetch all read the same way. Consumers should use the reading that
  ships with the contract rather than writing their own:

```ts
import { readClientErrorReporting } from '@objectstack/cloud-connection';

// `payload` may be the parsed body, or undefined when the fetch failed.
const sink = readClientErrorReporting(payload);
if (sink) initErrorReporting(sink);
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
sink above is refused rather than served.

See `docs/adr` in the cloud repository (ADR-0008) for the full architecture
decision.
