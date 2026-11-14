---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a refused SSO sign-in names a domain or email refusal instead of an expired link

Clause-②: yes (widening) — the `@object-ui/i18n` locale packs gain two keys under `auth.login.errors` (`ssoEmailDomainNotAllowed`, `ssoEmailNotAnAddress`) in all eleven shipped locales; no key is renamed or removed.
Metadata-protocol: none

When single sign-on refuses to create an account, the browser lands on the Console sign-in page with the refusal code. Two codes had no sentence of their own and read as "the sign-in link expired or was already used. Please try again.", which sent people to retry a sign-in that fails the same way every time:

- `EMAIL_DOMAIN_NOT_ALLOWED` (SSO domain verification on, and the email is not at a domain the identity provider has proven) now says no account was created because the email address is not at a domain the organization's sign-in service has verified with this system, and asks the person to have their administrator check the single sign-on setup.
- `INVALID_EMAIL` (the identity provider's sign-in resolved to a value that is not an email address) now says no account was created because the sign-in service did not send a usable email address, and asks the same of the administrator.

The `@object-ui/i18n` locale packs gain two keys under `auth.login.errors` (`ssoEmailDomainNotAllowed`, `ssoEmailNotAnAddress`) in all eleven shipped locales; no key is renamed or removed. The technical code and description stay behind the details toggle, and every other refusal code keeps its sentence.
