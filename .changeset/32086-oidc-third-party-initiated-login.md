---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): an Okta or Entra ID app tile starts an OIDC sign-in (third-party-initiated login)

Clause-②: yes (widening)
Metadata-protocol: none

An IdP app tile starts an OIDC sign-in by sending the browser to the app's initiate login URI with `iss` and no `code` (OIDC Core 1.0 §4). On the provider's callback, `GET /api/v1/auth/sso/callback/:providerId`, `@better-auth/sso` answered that request `error=state_not_found`, because its own IdP-initiated handling runs only for a callback with a `code` and no `state`.

Under maintainer ruling A on #32150 (record 6764924025), a callback request carrying `iss` and no `code`, `state` or `error` now starts the vendor's own sign-in (`POST /sign-in/sso`, a fresh `state` and PKCE) and answers `302` to the IdP, only when all four hold: the provider is a registered OIDC provider, its `allowIdpInitiated` option is on, `iss` equals its registered issuer byte for byte, and `target_link_uri` is absent, same-origin or a trusted origin. Any miss keeps `error=state_not_found` and writes one `warn` line naming it (`provider_not_registered`, `provider_not_oidc`, `idp_initiated_off`, `issuer_mismatch`, `target_link_uri_untrusted`, `start_refused`).

The entry mints nothing: it sets no session cookie and writes no `sys_session` row. The start is re-dispatched without the browser's cookies, and a session is still created only by the vendor's callback after the IdP returns a `code` for that `state`, the code exchange succeeds and the ID token verifies. A callback with a foreign or missing `state` is refused as before. No configuration key is added. Documented in `content/docs/permissions/sso.mdx` ("From an IdP app tile").

The SAML refusal causes are now exported from the package entry beside the OIDC ones: `SSO_SAML_REFUSAL_CAUSES`, `SSO_SAML_UNCLASSIFIED_REFUSAL` and the `SsoSamlRefusalCause` type.
