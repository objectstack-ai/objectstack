---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a JIT sign-in reads the IdP `locale` claim into the user's language preference, so a hosted environment follows the cloud account language

Clause-②: no
Metadata-protocol: none

When an external IdP sign-in creates or refreshes a user just-in-time (the cloud as IdP on a hosted environment through `oidcProviders`, any generic-OAuth or social provider, or a `@better-auth/sso` OIDC provider), the standard OIDC `locale` claim now becomes `sys_user.locale`, the column the console reads as the signed-in user's language and messaging reads per recipient.

- **First creation:** the claim sets the preference.
- **A later sign-in:** the claim updates it only while the user has not picked a language in the environment itself. A local choice wins and is never overwritten; clearing it hands the column back to the IdP.
- **An unknown or unsupported claim:** nothing is stored (an IdP-written value is cleared), so the deployment default applies. The claim is closed against the locales the i18n service reports (`i18n.supportedLocales` when the app declares them), matched exact, then case-insensitive, then by base language (`en-US` → `en`, `ja` → `ja-JP`), and the supported spelling is stored. The underscore spelling (`zh_CN`) reads as the tag it stands for.
- **No claim:** nothing changes.

What the IdP last wrote is recorded per user in `sys_verification` (identifier `idp-locale:` plus the user id), so an IdP-written value can be told apart from a local choice; no schema changes. Applying the claim never fails a sign-in: a store that refuses the write is reported at `warn` and the user keeps the language they had.
