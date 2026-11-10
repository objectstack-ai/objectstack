---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a refused IdP-initiated SAML sign-in lands on the platform's sign-in page with its error

Clause-②: no
Metadata-protocol: none

A SAML sign-in the identity provider starts on its own (an Okta or Entra app tile) carries no relay state, so `@better-auth/sso` redirected every refusal of it to the bare app origin, for example `/?error=unsolicited_response` when the provider's `allowIdpInitiated` option is off. The Console's root redirect drops the query string, so the sign-in page showed nothing. Such a refusal now lands on the platform's sign-in page (`/_console/login`), the same page a sign-in that names no `errorCallbackURL` lands on, with `error=` and `error_description` unchanged: `unsolicited_response`, and also `SELF_REGISTRATION_CLOSED`, `account_not_linked` or `saml_error` when the option is on. The refusal is unchanged otherwise, and nobody is signed in. An allowed IdP-initiated sign-in still lands on the app origin, and a provider whose stored SAML configuration names its own `idpInitiatedCallbackUrl` keeps sending its refusals there.
