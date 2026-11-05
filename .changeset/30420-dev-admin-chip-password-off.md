---
'@object-ui/console': patch
---

fix(console): the sign-in page no longer offers "Sign in as dev admin" when email and password sign-in is off

Clause-②: no
Metadata-protocol: none

Under `os dev`, the sign-in page drew the dev-seeded admin row whenever `/api/v1/auth/config` reported `devSeedAdmin`. Its chip signs in with email and password, so with that sign-in turned off the server refused it (`EMAIL_PASSWORD_DISABLED`) while the rest of the page correctly offered only the configured providers. The row is now drawn only when the same config does not report `emailPassword.enabled: false`, the answer the sign-in form already reads.
