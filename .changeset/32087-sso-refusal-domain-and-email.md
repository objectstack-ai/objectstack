---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a refused SSO sign-in names a domain or email refusal instead of an expired link

Clause-②: yes (widening) — the `@object-ui/i18n` locale packs gain two keys under `auth.login.errors` (`ssoEmailDomainNotAllowed`, `ssoEmailNotAnAddress`) in all eleven shipped locales; no key is renamed or removed.
Metadata-protocol: none

When single sign-on refuses to create an account, the browser lands on the Console sign-in page with the refusal code. Two codes had no sentence of their own and read as "the sign-in link expired or was already used. Please try again.", which sent people to retry a sign-in that fails the same way every time:

- `EMAIL_DOMAIN_NOT_ALLOWED` now says no account was created because the email address is not at a domain this system accepts new accounts from, and asks the person to use their organization email or ask their administrator. Two refusals send this code to the sign-in page, and the sentence is true of both: SSO domain verification on with the email not at a domain the identity provider has proven, and the `email_domain` audience posture refusing a self-serve creation (a social sign-up included) whose email is not on the approved-domain list.
- `INVALID_EMAIL` (the identity provider's sign-in resolved to a value that is not an email address) now says no account was created because the sign-in service did not send a usable email address, and asks the same of the administrator.

The `@object-ui/i18n` locale packs gain two keys under `auth.login.errors` (`ssoEmailDomainNotAllowed`, `ssoEmailNotAnAddress`) in all eleven shipped locales; no key is renamed or removed. The technical code and description stay behind the details toggle, and every other refusal code keeps its sentence.
