---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a sign-in that skips the OIDC seams can apply the IdP locale rule through `AuthManager.applyIdpLocaleClaim`

Clause-②: yes (widening)
Metadata-protocol: none

An external OIDC sign-in already sets the user's language preference (`sys_user.locale`) from the IdP's `locale` claim. A host whose own door signs a user in without passing through better-auth's OIDC seams, such as the cloud's sso-exchange hand-off, had no way to apply the same rule, because the package entry exported none of it. Now it can, through the running auth manager (`ctx.getService('auth')`):

- **`AuthManager.applyIdpLocaleClaim(userId, claim)`** applies a claim (`{ providerId?, value }`) under the same rule and the same `idp-locale:` record as the OIDC path: the column is written only while it is unset or still holds the value an IdP sign-in last wrote, so a language the user chose in the environment is kept. The claim is closed against the i18n service's locales, and an unsupported one clears only an IdP-written value. It never throws: a failure is reported at `warn` and the user keeps the preference they had.
- **`IdpLocaleClaim`** is exported as a type from the package entry.
- **One owner for the rule.** The OIDC JIT path now settles its staged claim through the same method, so its behaviour is unchanged.

Nothing to do for existing hosts.
