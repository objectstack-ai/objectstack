---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a refused enterprise OIDC sign-in names its cause

Clause-②: no
Metadata-protocol: none

The SSO callback (`/sso/callback/:providerId`) used to answer every refused ID token with the same redirect, `error=invalid_provider&error_description=token_not_verified`, so an administrator could not tell a wrong audience from an expired token, a foreign issuer or a retired signing key. `error_description` now names the cause: `id_token_expired`, `id_token_not_yet_valid`, `id_token_audience_mismatch`, `id_token_issuer_mismatch`, `id_token_signing_key_unknown` or `id_token_signature_invalid`. A refusal outside those classes keeps `token_not_verified`. `error=` is unchanged. The server writes one `warn` line per refusal with `providerId`, `protocol: 'oidc'` and `cause`, and no token content or account signal. The list is exported as `SSO_OIDC_REFUSAL_CAUSES`.

better-auth's own log lines now go to the `AuthManager` logger at the level better-auth chose (`error` stays `error`, `warn` stays `warn`) instead of the console. With no logger configured they still go to the console. An `Error` argument is logged as its name, message and code only. The vendor's `error` line for a classified ID-token refusal is replaced by the `warn` line above.

SAML refusals are unchanged: `@better-auth/sso` does not expose their cause.
