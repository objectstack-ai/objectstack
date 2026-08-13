---
'@objectstack/plugin-auth': patch
---

Pin the credential-at-rest posture for `sys_scim_provider.scim_token` and `sys_oauth_application.client_secret`.

Both columns already store a one-way SHA-256 digest, but nothing held them there: no test referenced `storeSCIMToken` or `storeClientSecret` anywhere in the repo, and `@better-auth/scim`'s own default is `storeSCIMToken: 'plain'` — cleartext. A single option literal in `auth-manager.ts` was the only thing keeping a live IdP bearer out of a column that is readable over the generic data API.

The new pin drives `AuthManager`'s own plugin construction (not a hand-written `scim({ storeSCIMToken: 'hashed' })`, which would have certified the very regression it exists to catch), reads the stored row back at driver level, and asserts the digest relationship recomputed independently with `node:crypto` — including the negative case that the digest of the full bearer does not match, since the stored value covers only the inner base token decoded out of it.
