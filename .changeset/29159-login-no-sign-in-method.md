---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(auth): the sign-in card says no sign-in method is available instead of showing SSO-only copy when email+password is off and nothing else is advertised

Clause-②: yes (widening)
Metadata-protocol: none

With email+password sign-in turned off (`PUT /api/settings/auth {"email_password_enabled": false}`) and no SSO, the sign-in page read "Sign in with your organization's single sign-on" with no SSO button, plus a "Use a password instead" link to a form the server refuses (`EMAIL_PASSWORD_DISABLED`). Nobody could tell why there was no way in.

- **`@object-ui/auth`:** `LoginForm` reads SSO enforcement only from the server's `features.ssoEnforced`; `emailPassword.enabled: false` now means the password door is shut, not that an identity provider stands in front of it. When the server also advertises no SSO, no social or OIDC provider and no phone sign-in, the card shows "No sign-in method is available. Contact your administrator." with nothing to click and no sign-up link. The SSO line is drawn only under declared enforcement or when SSO is on, and the "Use a password instead" link only while the form it opens holds a method the server accepts (email+password, the SSO button or phone sign-in). New optional label `LoginFormLabels.noSignInMethodText`.
- **`@object-ui/i18n`:** `auth.login.noSignInMethodText` in all ten locale packs.
- **`@object-ui/app-shell`, `@object-ui/console`:** both sign-in pages pass the translated label.

Unchanged: an SSO-enforced deployment keeps its SSO-only view and break-glass link, and a failed `/auth/config` read still falls back to the password form.

What to do: nothing. A host that does not pass `noSignInMethodText` gets the English default.
