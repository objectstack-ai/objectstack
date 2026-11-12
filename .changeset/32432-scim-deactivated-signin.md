---
'@object-ui/auth': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(auth): a sign-in refused because the identity provider deactivated the account says so, instead of "You have been banned… contact support"

Clause-②: yes (widening)
Metadata-protocol: none

- **The login page tells a deactivation from a ban.** plugin-auth refuses the password sign-in of an account its identity provider deactivated through SCIM with `403 BANNED_USER` and `details: { cause: 'scim_deactivated' }`. The Console login page and `DefaultLoginPage` showed better-auth's "You have been banned from this application. Please contact support if you believe this is an error." for it. They now show "Your account has been deactivated by your organization. Contact your administrator." in the session's language. An administrator's ban answers with no `details` and keeps the server's wording.
- **`@object-ui/auth`:** a refused call that goes through the auth client's error mapping now carries the response body's `details` object on the thrown error (`error.details`), beside `code`, `message`, `dependents` and `userMessage`. A `details` value that is not a plain object is not carried.
- **`LoginForm`'s `errorMessages`** is read under `CODE:cause` first (the refusal's `code` and `details.cause`, for example `BANNED_USER:scim_deactivated`), then under `CODE`, then the server's message is shown. A refusal with no cause, or with a cause the map has no entry for, answers exactly as before.
- **`@object-ui/i18n`** adds `auth.login.errors.accountDeactivated` to all 11 packs.
