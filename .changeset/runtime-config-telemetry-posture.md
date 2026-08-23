---
"@objectstack/cloud-connection": minor
---

**Security (p0, upstream half):** `GET /api/v1/runtime/config` now carries a `telemetry` block, giving the Console SPA a **post-build off switch** for client error reporting (#10805, upstream half of `cloud#1508`).

An air-gapped on-premises EE Console was measured sending **14 Sentry envelopes per session** to `sentry.io`, carrying IP and User-Agent PII, with no way for the customer to turn it off. objectui closed the half it owns — a build that never opts in now issues no third-party request at all — and could not close the other: every telemetry knob there is a Vite build-time variable inlined into the bundle as a frozen literal, so a build that **did** opt in (the hosted console, and the identical artifact shipped on-prem) had no switch that editing env vars on the deployed host could reach. The only server-to-SPA channel is this endpoint.

```json
{ "telemetry": { "allowClientErrorReporting": false } }
```

Operators grant it with `OS_TELEMETRY_CLIENT_ERROR_REPORTING_ENABLED=true`, or hosts with `new RuntimeConfigPlugin({ allowClientErrorReporting: true })`. The switch answers to the repo's usual truthy vocabulary (`1` / `true` / `on` / `yes`); an unrecognised spelling is refused and named at mount time rather than coerced.

**Denied by default on every posture, not only the air-gapped one.** Deriving "connected therefore allowed" would have left the reported injury class open one deployment over: an internet-connected on-prem box runs the *same build artifact* as the hosted console, so the DSN cannot tell them apart, and its customer has equally never heard of Sentry. A universal opt-in satisfies "air-gap defaults off" strictly, and satisfies it without having to identify the posture correctly — which matters, because a posture predicate that is wrong in the *allow* direction is this card's own defect.

**A permission, never a source.** The server supplies no DSN and cannot start telemetry for a build that carries none; `true` means only "this deployment does not object to the sink you were compiled with". The composed decision stays `Boolean(buildTimeDsn) && isClientErrorReportingAllowed(payload)`.

**A runtime that declared its control plane off cannot grant it.** `OS_CLOUD_URL=off` (or `none` / `local` / `disabled`) refuses the grant and says so in the boot log — the copied-hosted-config-onto-an-air-gapped-box shape. That declaration is the repo's one existing network-posture signal and needs no new knob: the EE image's compose file already defaults `OS_CLOUD_URL` to `off`, so the operator this failed is safe with zero configuration.

**Absence is denial, and the reading ships with the contract.** A new export, `isClientErrorReportingAllowed(payload)`, is the canonical fail-closed reader: an older runtime's payload, a malformed body, a 404 and a failed fetch (pass `undefined`) all answer `false`. It is exported rather than left to consumers because "absent means do not send" is a claim about *their* code, and a hand-written `?.` chain is one `!== false` away from re-opening the leak on exactly the legacy payloads the guarantee is for. The key is spelled as a permission for the same reason: a negative `disabled` flag would have read falsy — therefore "send" — on every one of those states.

`isControlPlaneDeclined()` is factored out of `cloud-url.ts` so "what counts as off" has one definition shared by the URL resolution and the telemetry refusal. No behaviour change to `resolveCloudUrl()`.

The consumer half (reading the key and gating `initSentry`) is objectui's and is filed separately.
