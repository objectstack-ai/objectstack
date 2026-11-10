---
'@object-ui/auth': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(console): a refused single sign-on says why in words an end user can act on, "Sign in with SSO" with no email asks for one, and a checkbox no longer draws as a circle

Clause-②: yes (widening)
Metadata-protocol: none

- **The login page names each refusal.** A single sign-on refused with `SELF_REGISTRATION_CLOSED`, `account_not_linked`, `saml_error` / `invalid_saml_response` or `state_not_found` used to read "the sign-in link expired or was already used. Please try again." followed by the raw cause in parentheses. Each now has its own sentence ("Your account isn't set up for this system yet. Ask your administrator to invite you.", and so on). The code and the server's description, which are written for administrators, move behind a "Technical details" toggle under the banner. A code with no sentence of its own keeps the generic one.
- **`LoginForm` checks the email before it asks the server.** Pressing "Sign in with SSO" with an empty or whitespace-only email field used to send the request and show the server's `email, organizationSlug, domain or providerId is required`. It now shows "Enter your work email to sign in with SSO." and sends nothing. The same sentence replaces the untranslated one a phone number in that field got. The text is the new `LoginFormLabels.ssoEmailRequiredText` label (optional; English default as above), which both login pages pass from `auth.login.ssoEmailRequiredText`.
- **`@object-ui/i18n`** adds `auth.login.ssoEmailRequiredText` and `auth.login.errors.ssoAccountNotInvited`, `ssoAccountNotLinked`, `ssoResponseRejected`, `ssoStartFromLoginPage` and `ssoTechnicalDetails` to all 11 packs.
- **Console theme:** the 16px checkbox drew `rounded-sm` at 10px under the theme's larger corner radius, so every checkbox looked like a radio button, for example the two independent toggles of "Edit Sign-In Options". The console stylesheet now gives the checkbox a 4px corner; every other `rounded-sm` is unchanged.
