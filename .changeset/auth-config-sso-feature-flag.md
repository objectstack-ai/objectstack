---
"@objectstack/plugin-auth": patch
---

feat(auth): surface `features.sso` in the public `/auth/config` response

`getPublicConfig()` reported every other auth capability flag (`oidcProvider`,
`twoFactor`, `multiOrgEnabled`, …) but omitted enterprise SSO, even though the
manager already computes whether the domain-routed `@better-auth/sso` plugin is
wired (`OS_SSO_ENABLED` / `plugins.sso`). Without it the login UI had no signal
to gate on, so it rendered a "Sign in with SSO" button unconditionally — and on
a self-hosted / local deployment where SSO isn't wired, clicking it only then
surfaced "No SSO provider is configured for this email domain."

The config now includes `features.sso`. `getPublicConfig()` returns the coarse
"is the plugin wired" flag — resolved with the EXACT logic that decides whether
the plugin is mounted in `buildPlugins()`, so the advertised capability can never
disagree with the actual `/sign-in/sso` route. The `/auth/config` route then
refines it to "usable" via the new `AuthManager.isSsoUsable()`, which additionally
requires at least one `sys_sso_provider` row to exist — so a freshly-enabled but
unconfigured SSO setup doesn't advertise a button that errors for everyone.
`isSsoUsable()` only queries when wired and fails open to the wired flag on any
introspection error (no data engine, query failure), so config never 500s. The
console login form consumes `features.sso` to hide the button (objectui side).
