# Error Tracking (Console)

Sentry error reporting is **already built into the Console**. There is nothing to
install and no init code to write — this guide is about *turning it on*, which happens
entirely on your **ObjectStack server**. You never rebuild the Console.

> ⛔ **Do not add your own `Sentry.init()` / `src/lib/sentry.ts` to the Console.** A
> second init is not gated by anything below, so it would report regardless of what the
> deployment configured — rebuilding the exact "decision frozen at build time, no
> operator switch" shape that objectui#5522 existed to remove. The integration below is
> the supported path; extend it, don't duplicate it.

## The gate: the runtime serves the DSN, and that IS the grant

```
send  ⇔  the runtime served a DSN on /api/v1/runtime/config
```

One knob, in one place. There is no second permission flag to set, and no build-time
key to inject — **presence of the DSN is the whole opt-in**, and unsetting it is how you
turn reporting off.

That collapse is deliberate (objectstack#12681). Reporting briefly needed two opt-ins, a
build-time DSN *and* a runtime permission, which produced two silent dead states —
"permission on, no DSN" and "DSN in, permission off" — that look identical from the
browser. More importantly it did not work for this platform at all: ObjectStack's users
consume a **prebuilt** Console, so a build-time key was unreachable for them, and a
self-hosting operator could not enable reporting no matter what they set.

The decision lives in one place, `resolveSentryGate()` in
`packages/app-shell/src/observability/sentry.ts`, and is pinned case by case in
`sentry.test.ts`.

## Configuring it (on the ObjectStack runtime)

Set these on the **server**, not on any Console build:

```bash
OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN=https://PUBLIC_KEY@HOST/PROJECT_ID
```

That single variable enables reporting. The rest are optional and inert without it:

| Variable | Default | Effect |
|:--|:--|:--|
| `OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN` | — | **The sink, and the grant.** Unset ⇒ `initSentry()` returns `false` and `@sentry/react` is never even imported, so the vendor-sentry chunk is never fetched. |
| `OS_TELEMETRY_CLIENT_ERROR_REPORTING_SEND_DEFAULT_PII` | `false` | `=true` opts in to sending **IP address + User-Agent**. Off by default: one artifact serves both SaaS and on-prem, so PII collection must be the deliberate choice of the deployment that wants it. |
| `OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENVIRONMENT` | — | `environment` tag on events. Unset lets the Console fall back to its own build mode. |
| `OS_TELEMETRY_CLIENT_ERROR_REPORTING_TRACES_SAMPLE_RATE` | `0.1` | Fraction (`0`–`1`) of transactions sampled for performance tracing. |
| `OS_TELEMETRY_CLIENT_ERROR_REPORTING_REPLAY_SAMPLE_RATE` | `0` | Fraction (`0`–`1`) of **error** sessions recorded as session replays. Off by default — replay records what the user did. |

…or, from a host that composes the plugin directly:

<!-- doc-snippet: fragment — `RuntimeConfigPlugin` is the host runtime's own class, shipped by `@objectstack/cloud-connection` or `@objectstack/objectos-runtime`; neither is a dependency of any package in this workspace, so the specifier does not resolve here -->
```ts
new RuntimeConfigPlugin({
  clientErrorReporting: { dsn: 'https://PUBLIC_KEY@HOST/PROJECT_ID', sendDefaultPii: true },
})
```

An explicit option wins over the matching environment variable, **per field** — setting
only `sendDefaultPii` here does not discard the operator's `..._DSN`.

Canonical rows for these variables:
[Environment Variables → Observability](https://objectstack.ai/docs/deployment/environment-variables)
(`content/docs/deployment/environment-variables.mdx` in the objectstack repo).

### Malformed values are refused at mount, never coerced

`RuntimeConfigPlugin` names the rejected value in a warning at boot and carries on, so a
typo does not quietly half-work — **check your server's startup log if reporting stays
silent**. Every refusal lands on the safer value:

- a **DSN** that is not an `https://PUBLIC_KEY@HOST/PROJECT_ID` URL is refused and no
  sink is served at all — there is no safe default for a source;
- a DSN carrying a **secret** after the public key is refused outright. This payload is
  read by every browser that loads the Console, so a legacy secret-bearing DSN would
  publish that secret to every visitor while looking entirely ordinary. Reissue it
  without the secret;
- a bad **sample rate** falls back to its documented default rather than taking the sink
  down with it, and a bad **PII** spelling falls back to off. The boolean knobs answer to
  a closed vocabulary — `1` / `true` / `on` / `yes` and `0` / `false` / `off` / `no`.

Quoted DSNs in those warnings are key-redacted: boot logs travel further than the
configuration they quote.

### ⚠️ `OS_CLOUD_URL=off` overrules a configured DSN

A runtime that declared its control plane off has declined outbound calls, and this one
with it — no sink is served and the refusal is warned about at mount. This is the
copied-env-file shape cloud#1508 reported: a hosted configuration landing on an
air-gapped box.

## The one build-time knob left

| Variable | Effect |
|:--|:--|
| `VITE_SENTRY_RELEASE` | The release the events are tagged with. Defaults to `VITE_APP_VERSION`, then `unknown`. |

It stays build-time because it is genuinely a property of the *build*: it identifies
which bundle produced a stack trace and must match the source maps that bundle's pipeline
uploaded. A server cannot know which Console build it is serving. Every other
`VITE_SENTRY_*` variable is retired — `VITE_SENTRY_DSN` included.

⛔ **Never commit a DSN** — not to `.env.production`, not as an "example", and not under
a runtime-side variable name either. Vite inlines every `VITE_*` from a committed `.env`
file into the published bundle as a frozen object literal, so a committed DSN is a live
third-party endpoint compiled into an artifact that lands inside customer networks, and
nothing on the deployed host can edit it back out. The ratchet
`packages/app-shell/src/observability/committed-telemetry-endpoint.test.ts` fails CI if
any committed `.env*` file carries a telemetry endpoint or turns PII on by default; its
rules are keyed on the variable's suffix and on the value, so they cover both spellings.

## Fail-closed contract

**No runtime-served DSN ⇒ no reporting, silently, by design.** Every "cannot determine
the answer" state — the config fetch failed, the endpoint 404s, the runtime predates the
key, a third-party host, the config has not arrived yet — reads as **off**. An unreported
error is recoverable; PII leaving an air-gapped deployment is not. Silence is therefore
the *correct* behaviour, not a bug to work around: if you want reporting, configure the
DSN rather than loosening the gate.

This is stronger than the permission boolean it replaced, and for a structural reason:
absence of a *source* is not a value that can be misread, whereas a boolean needed a
strict `=== true` and a written argument about why a negative `disabled` flag would have
been vacuous on exactly the runtimes that were leaking.

Note the direction differs from `isMarketplaceEnabled()` / `isAiStudioEnabled()`, which
fail **open**. Do not "make it consistent" with them.

### Ordering, if you embed app-shell in your own host

`initSentry()` must run **after** `initRuntimeConfig()` has settled — the DSN itself is a
server-pushed value, so before the payload arrives there is no sink at all, and
`initSentry()` memoizes its verdict on first call. Calling it at module-eval time freezes
"no sink" for the whole session, turning the operator's only switch into a permanent
removal. `apps/console/src/main.tsx` does this correctly: `initSentry()` is kicked off
inside `.finally()` on the boot `Promise.all`, so a failed config fetch still never blocks
first paint (and on that path no sink arrived, so the failure direction is silence).

## Reporting errors from your own code

Use the built-in helpers from `@object-ui/app-shell` — they route through the same gate
and no-op when it withheld, so they cannot become a second ungated path:

<!-- doc-snippet: fragment — the two calls a host makes; `err` and `user` are the caller's own values, supplied by the surrounding catch block and the signed-in session -->
```ts
import { captureError, setSentryUser } from '@object-ui/app-shell';

captureError(err, { where: 'record-save' });  // no-op unless the gate passed
setSentryUser({ id: user.id });               // pass null on logout
```

`packages/app-shell/src/chrome/ErrorBoundary.tsx` already calls `captureError()` with the
React component stack, so uncaught render errors are covered without any wiring.

## Verifying a deployment

1. **Check what the runtime is serving** — the whole configuration is now inspectable
   from outside:

   ```bash
   curl -s https://your-deployment.example.com/api/v1/runtime/config | jq .telemetry
   # → { "errorReporting": { "dsn": "https://…", "sendDefaultPii": false,
   #                          "tracesSampleRate": 0.1, "replaysOnErrorSampleRate": 0 } }
   ```

   `{}` means this runtime knows the key and has no DSN configured — fix that first. No
   `telemetry` key at all means the payload did not come from a runtime that knows the
   key (an older ObjectStack, or a third-party host).

2. **Confirm the SDK loads** — in the browser devtools **Network** tab, the
   `vendor-sentry` chunk should be fetched on load. If step 1 showed a DSN and this chunk
   never appears, the Console build is older than objectstack#12681.

3. **Trigger a test error** — in the browser console, `throw new Error('Test error')`.

4. **Confirm it lands** in your Sentry project, tagged with the expected `environment`
   and `release`.

## Source maps

The Console build sets `sourcemap: false` (`apps/console/vite.config.ts`). For readable
stack traces, enable source maps in CI only, upload them, then discard them rather than
publishing them with the bundle:

```yaml
- name: Upload Source Maps
  run: |
    npx @sentry/cli sourcemaps upload \
      --auth-token $SENTRY_AUTH_TOKEN \
      --org your-org \
      --project objectui-console \
      --release $VITE_SENTRY_RELEASE \
      apps/console/dist/assets/
```

Keep `--release` identical to the `VITE_SENTRY_RELEASE` the bundle was built with, or the
uploaded maps will not match the events.

## Content Security Policy

The Console ships **no CSP meta tag** today — `apps/console/index.html` sets none, and the
repo defines no default policy. Nothing in the Console needs relaxing for Sentry out of
the box.

If **your hosting layer** serves CSP headers (many do), Sentry's ingest endpoint has to be
reachable or events are dropped silently by the browser:

```
connect-src 'self' https://*.ingest.sentry.io;
```

Match the origin to the DSN **your runtime serves** — `*.ingest.sentry.io` for current
Sentry SaaS projects, your own host for a self-hosted Sentry. Worth re-checking whenever
you change `OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN`: the DSN can now be repointed at a
different ingest origin without any Console rebuild, so a CSP that was correct before the
change can start dropping events with nothing else having moved.

## Related

- `packages/app-shell/src/observability/sentry.ts` — the gate and its rationale
- `packages/app-shell/src/runtime-config.ts` — `getClientErrorReporting()`
- `apps/console/.env.production` — why no telemetry variable belongs there
- objectui#5522 · objectstack#12681 · objectstack#10805 · objectstack-ai/cloud#1508
