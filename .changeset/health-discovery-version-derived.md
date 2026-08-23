---
"@objectstack/runtime": patch
---

fix(runtime): `version` on `GET /health` and the discovery payload is derived, not a hardcoded `'1.0.0'` literal (#10993)

Both `HttpDispatcher`'s `/health` handler and its discovery payload
(`getDiscoveryInfo()`, served at `/`, `/discovery`, and everywhere else
`DiscoverySchema` is answered) reported a literal `version: '1.0.0'` —
unrelated to the package, the build, or anything actually running, and
identical on every deployment (single-env, EE, every hosted tenant). A field
that looks authoritative and lies is worse than no field: `cloud`
(objectstack-ai/cloud#1537) needed `/health` to name the serving artifact
after a production container served a three-month-old image behind four
green deploys, could not use it because the value never changed, and
resorted to a container-stamped response header instead.

`HttpDispatcher` now resolves `version` once at construction
(`resolveRuntimeVersion()`, `packages/runtime/src/runtime-version.ts`):

1. `OS_RUNTIME_VERSION`, if the host injects one (an image tag, a git sha, a
   release version) — the SAME env var `cloud-connection-plugin.ts` already
   reads for a device-bind approval URL, reused rather than inventing a
   second name for the same value.
2. Otherwise, `@objectstack/runtime`'s own resolved `package.json` version.
3. `'unknown'` only if both are unavailable — never a plausible-looking
   literal a caller could mistake for real identity.

The liveness contract is unchanged: `/health` still checks nothing beyond
"this process is executing code" (framework#3756); this only changes where
one field's VALUE comes from. No schema widening — `DiscoverySchema` already
declared `version: z.string()`.
