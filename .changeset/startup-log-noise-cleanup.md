---
"@objectstack/spec": patch
"@objectstack/objectql": patch
"@objectstack/plugin-auth": patch
---

fix(dev): eliminate three fixed startup log warnings so official examples boot clean (#3420)

`os dev` on the stock showcase printed three fixed noise sources on every boot,
with zero example-side changes — training users to ignore warnings.

- **spec** — add a field-level `ackPlaintextMasking: true` opt-out for the
  generic `password` author-time warning (ADR-0100). A deliberately-masked
  field (like field-zoo's `f_password`) can now affirm intent instead of
  printing an un-actionable "safe to ignore" on every boot; the warning text
  points authors at the flag.
- **plugin-auth** — pass better-auth's documented
  `silenceWarnings.oauthAuthServerConfig` to `oauthProvider(...)`. We already
  mount the `/.well-known/oauth-authorization-server` documents ourselves at
  the issuer root, so the plugin's "please ensure it exists" reminder was a
  false positive (printed twice); silencing it removes both.
- **objectql** — route the Registry's re-register / package-overwrite lines
  (normal rebuild / HMR / seed-replay paths) through a new debug-only
  `SchemaRegistry.debug()` so they stay out of the default `info` boot log. Adds
  a `logLevel` construction option (and matching `OS_REGISTRY_LOG` env var) so
  the debug-gated housekeeping is discoverable for troubleshooting.
