---
'@objectstack/plugin-auth': minor
---

fix(plugin-auth): give the auth `basePath` default a single written definition (#16384)

`'/api/v1/auth'`, the shipped default for `AuthPlugin`'s `basePath` option, was
written independently at four sites: the `AuthPlugin` constructor, two later
re-derivations inside `AuthPlugin` (`registerAuthRoutes`, the OIDC discovery
`.well-known` alias), and `AuthManager.configuredBasePath()`'s own fallback.
Nothing was broken by the duplication — `AuthPlugin` always supplies `basePath`
to `AuthManager`, so the manager's copy was dead on the live path and
unfalsifiable by construction: no test could have caught one copy drifting from
the other three.

The default now lives in exactly one place, `DEFAULT_AUTH_BASE_PATH` (exported
from `@objectstack/plugin-auth`, declared beside `readMcpServerEnabledEnv` in
`auth-manager.ts`); all four sites import it instead of retyping the literal.
Every site evaluates byte-identically to before — this is a consolidation of
where the value is *written*, not a change to what any site *evaluates to*, and
in particular does **not** touch `AuthManager`'s `configuredBasePath` →
`rootedBasePath` → `getBasePath` normalisation chain (#16399) or the published
OAuth `iss` / RFC 8707 `aud` identifiers those getters produce.

This is additive and non-breaking — no existing call site's behaviour changes —
but it does add one new named export (`DEFAULT_AUTH_BASE_PATH`) to the
package's public surface, which is what makes this `minor` rather than `patch`.
