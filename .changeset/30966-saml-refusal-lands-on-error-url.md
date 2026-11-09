---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a refused SAML sign-in lands on the error URL, as OIDC does

Clause-②: no
Metadata-protocol: none

The SAML ACS (`POST /sso/saml2/sp/acs/:providerId`) used to redirect an account refusal (`account_not_linked`, `signup_disabled`, `unable_to_link_account`, `unable_to_create_user`, `email_not_verified`, `unable_to_create_session`) to the sign-in's success `callbackURL` with only `?error=`, so the user landed on the signed-in page without being signed in. A response over the size limit was sent to the app origin. Every SAML refusal now lands where the OIDC callback sends one: the sign-in's `errorCallbackURL`, or the platform's sign-in page when none was given. `error=` and `error_description` are unchanged. A successful sign-in still lands on `callbackURL`.
