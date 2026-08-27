---
"@objectstack/cloud-connection": minor
---

**Security (p0, upstream half):** `GET /api/v1/runtime/config` now serves the Console's client error-reporting **sink** — the DSN itself, plus the closed set of knobs that travel with it — so a self-hosting operator configures telemetry on the server, in one place, with no frontend rebuild (#12681, upstream half of `cloud#1508`).

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

An air-gapped on-premises EE Console was measured sending **14 Sentry envelopes per session** to `sentry.io`, carrying IP and User-Agent PII, with no way for the customer to turn it off. The first fix (#10805) served a runtime *permission* and left the *source* where it was — a build-time `VITE_SENTRY_DSN` inlined into the published bundle. That closed the leak and opened a different hole, which the maintainer named on 2026-08-27:

> 「我是一个开发平台呀，我的用户并不会去构建我的前端，我理解这种应该在服务端传进去。」

ObjectStack's users consume a **prebuilt** Console. They cannot set a build-time key, so under the two-key gate a self-hosting operator could not enable client error reporting at all: the permission was reachable and the source was not.

**The DSN's presence IS the grant.** There is no second boolean, and this is not shorthand — it removes the failure mode the two-key shape had. With a permission and a source configured in different places, "permission on, no DSN" and "DSN in, permission off" are two silent dead states that look identical from the browser. One knob cannot disagree with itself.

The fail-closed direction survives the collapse for free, and more robustly than the boolean managed: the grant is now "a non-empty DSN reached me", so an older runtime, a third-party host, a 404, a network error, a malformed body and a payload that has not arrived yet all carry no DSN and therefore deny. A boolean needed `=== true` plus a written argument about why `disabled: true` would have been vacuous; absence of a *source* is not a value that can be misread.

**Everything that must travel with the DSN travels with it.** `sendDefaultPii`, `environment`, `tracesSampleRate` and `replaysOnErrorSampleRate` were build-time `VITE_SENTRY_*` variables, which a prebuilt-console consumer could set none of — including the one deciding whether IP and User-Agent leave the network. This is not new surface; it is the same surface moved to the side that can operate it. One knob deliberately did **not** move: a release identifies *which bundle* produced a stack trace and must match that build's uploaded source maps, so `VITE_SENTRY_RELEASE` stays build-time in objectui and is the only `VITE_SENTRY_*` knob that does.

**Malformed is refused at mount, never coerced**, and every refusal lands on the safer value. A DSN that is not an `https://PUBLIC_KEY@HOST/PROJECT_ID` URL is refused and the whole block withheld — there is no safe default for a source. A DSN carrying a **secret** after the public key is refused for a different reason: this payload is read by every browser that loads the Console, so a legacy secret-bearing DSN would publish that secret to every visitor while looking entirely ordinary. A bad sample rate falls back to its documented default instead, because silencing error reporting over a typo in a volume knob would be strictness pointed away from the hazard. Quoted values are key-redacted: boot logs travel further than the configuration they quote.

**A runtime that declared its control plane off serves no sink.** `OS_CLOUD_URL=off` (or `none` / `local` / `disabled`) refuses the DSN and says so in the boot log — the copied-hosted-config-onto-an-air-gapped-box shape. That declaration is the repo's one existing network-posture signal and needs no new knob: the EE image's compose file already defaults `OS_CLOUD_URL` to `off`, so the operator this failed is safe with zero configuration.

**Absence is denial, and the reading ships with the contract.** `readClientErrorReporting(payload)` is the canonical fail-closed reader, returning the sink or `null`; a failed fetch is spelled by passing `undefined`, so the error path and the absent path reach the same answer through the same function. It is exported rather than left to consumers because "no DSN means do not send" is a claim about *their* code.

### Breaking: `telemetry.allowClientErrorReporting` is REPLACED, not paralleled

The #10805 permission boolean is removed in this same change — no dual-spelling window. It was added days ago, is **unreleased** (it appears in no published `CHANGELOG.md`), and no deployment consumes it; its pending changeset is superseded by this one rather than shipping a feature and its removal in the same release notes.

| FROM | TO |
|:--|:--|
| `OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENABLED=true` | `OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN=https://PUBLIC_KEY@HOST/PROJECT_ID` |
| `new RuntimeConfigPlugin({ allowClientErrorReporting: true })` | `new RuntimeConfigPlugin({ clientErrorReporting: { dsn: '…' } })` |
| `telemetry.allowClientErrorReporting: boolean` on the payload | `telemetry.errorReporting?: { dsn, sendDefaultPii, environment?, tracesSampleRate, replaysOnErrorSampleRate }` |
| `isClientErrorReportingAllowed(payload): boolean` | `readClientErrorReporting(payload): ClientErrorReportingConfig \| null` |
| `CLIENT_ERROR_REPORTING_ENV` | `CLIENT_ERROR_REPORTING_DSN_ENV` (plus `..._PII_ENV`, `..._ENVIRONMENT_ENV`, `..._TRACES_RATE_ENV`, `..._REPLAY_RATE_ENV`) |

One-line fix for an operator: replace the `..._ENABLED=true` line with a `..._DSN=` line carrying your DSN. One-line fix for a consumer: `if (readClientErrorReporting(payload)) …` in place of `if (buildTimeDsn && isClientErrorReportingAllowed(payload)) …` — the build-time conjunct is gone, because the server now supplies the source.

**Landing order is safe in both directions.** An old client meeting this server reads an absent `allowClientErrorReporting` and denies; a new client meeting an old server reads an absent DSN and stays off. Neither half can turn reporting on by itself, so the two repos' PRs can land in any order.

<!-- adr-0087: not-required (unpublished) the replaced boolean, its env var, its config option and its reader were added by #10805 and never shipped in a published release — `@objectstack/cloud-connection@17.2.0` carries no mention of them and their changeset was still pending in `.changeset/`, so there is no upgrader to reach. -->
