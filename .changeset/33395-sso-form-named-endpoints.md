---
'@objectstack/platform-objects': patch
---

feat(platform-objects): the Register SSO Provider form names the token, authorization and JWKS endpoints

Clause-②: yes (widening) — the `register_sso_provider` action on `sys_sso_provider` gains three optional params, `authorizationEndpoint`, `tokenEndpoint` and `jwksEndpoint` (type `url`), and the object translation bundles gain their label and help-text keys. The register bridge, `POST /api/v1/auth/admin/sso/register`, already accepted all three; nothing it accepted before is refused now.
Metadata-protocol: none

**Setup → SSO Providers → Register SSO Provider** now offers **Authorization URL**, **Token URL** and **JWKS URL** beside **Discovery URL** and **Userinfo URL**. Each is posted to the register bridge under the `oidcConfig` member of the same name, kept instead of the endpoint the discovery document names, and trusted for that provider. Name one when the registration is refused `400 discovery_untrusted_origin` because the discovery document names that endpoint on a host the server does not trust. An identity provider whose token, key and userinfo endpoints sit on hosts other than its issuer's, such as Google (`https://oauth2.googleapis.com/token`, `https://www.googleapis.com/oauth2/v3/certs`, `https://openidconnect.googleapis.com/v1/userinfo`), now registers from Setup by filling Token URL, JWKS URL and Userinfo URL; before, only the API door took those endpoints.

The three new fields are blank by default, and a blank field sends nothing, so a registration that names none of them is unchanged. The translated locales show the new labels and help texts in English until they are translated.
