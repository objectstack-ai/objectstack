---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(auth): a cloud-managed runtime's password refusal is shown in the session's language and points at the identity provider's button

Clause-②: yes (widening) — `@object-ui/auth` `ForgotPasswordFormProps` gains the optional `errorMessages`; `@object-ui/i18n` gains `auth.login.errors.managedPasswordSignIn` and `auth.login.errors.managedPasswordReset` in every locale
Metadata-protocol: none

A cloud-managed runtime refuses the password doors (sign-in, forgot password, reset password, set password) with 409 `RESOURCE_CONFLICT`. Its code never reached the pages. The hosted relay and the set-password route answer in the platform's error envelope, `{ success: false, error: { code, message } }`, which the auth client did not read. Forgot and reset dropped the code where the client threw. So each of those pages showed the server's English sentence or `Auth request failed with status 409`, whatever the language.

- **`@object-ui/auth`.** The client's error builder reads `code`, `message`, `details` and `userMessage` from the envelope's `error` when the flat body has none; a better-auth refusal answers exactly as before. `forgotPassword`, `resetPassword` and `setInitialPassword` now keep the refusal's code and status too. `ForgotPasswordForm` gains an `errorMessages` prop, the same code-to-text map `LoginForm` takes; without it the server's message is shown as before.
- **`@object-ui/app-shell`.** `signInRefusalMessages` maps `RESOURCE_CONFLICT` to a sentence that says the deployment signs people in through its identity provider and points at its button above the form. The new `passwordDoorRefusalMessages` carries the matching sentence for the forgot, reset and set-password doors, and the package's forgot-password page passes it.
- **`@object-ui/i18n`.** Two keys, `auth.login.errors.managedPasswordSignIn` and `auth.login.errors.managedPasswordReset`, in every locale.
- **`@object-ui/console`.** The forgot-password, reset-password and set-password pages show the same sentence.

On the sign-in door only a cloud-managed runtime answers this code, so a self-hosted sign-in is unchanged. On the reset and set-password doors a self-hosted deployment answers the same 409 `RESOURCE_CONFLICT` in two cases: an account its identity provider provisions while SSO-only mode is on, and a pending SSO person not yet signed in. Those pages now show the same localized sentence in place of the server's English one; it is true for that reader too. Nothing to migrate.
