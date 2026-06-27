---
"@objectstack/plugin-auth": minor
"@objectstack/platform-objects": minor
---

feat(auth): SAML 2.0 SSO via @better-auth/sso (ADR-0069 P3)

`@better-auth/sso@1.6.20` ships full SAML 2.0 (samlify-backed), so SAML needs no
custom plugin. Adds a `register_saml_provider` action on `sys_sso_provider` and a
`runRegisterSamlProviderFromForm` bridge that reshapes the flat admin form into the
nested `samlConfig` and re-dispatches through `/sso/register` (admin gate enforced),
returning the SP ACS + metadata URLs to configure on the IdP. Updates ADR-0069 to
correct the stale "SAML is out of better-auth core" premise.
