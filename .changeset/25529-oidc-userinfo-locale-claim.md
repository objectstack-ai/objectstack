---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): the platform OIDC provider emits the standard `locale` claim at userinfo, so an environment signing in through it follows the user's language

Clause-②: yes
Metadata-protocol: none

- **Before.** The OIDC provider plugin-auth composes (`oauthProvider`) passed no `customUserInfoClaims`, so `/oauth2/userinfo` never carried `locale`. An environment signing in through an ObjectStack OP (a hosted environment through the cloud) reads the claim off userinfo to set its JIT user's language (`idp-locale-claim.ts`), and so never received it.
- **Now.** Userinfo carries `locale` (OIDC Core §5.1) when the access token's scopes include `profile` and the user's `sys_user.locale`, read through the data engine in system context, is a BCP-47 tag the platform's column reader accepts (`normalizeRecipientLocale`). Otherwise the key is absent. Every ObjectStack OP emits it; there is no new configuration key, column or better-auth `additionalField`.
- **Userinfo only.** The ID token is unchanged: the provider keeps the standard profile claims out of it.
- **A failed read never fails userinfo.** The claim is omitted and the failure is logged once per request at `warn` through the host logger, naming the user.
