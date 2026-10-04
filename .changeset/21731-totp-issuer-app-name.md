---
'@objectstack/plugin-auth': patch
'@objectstack/cli': patch
---

A TOTP enrollment names the deployment, not the auth library. `/two-factor/enable` and `/two-factor/get-totp-uri` answered an otpauth URI whose issuer and label prefix were `Better Auth`, so every authenticator app listed the account under that name. They now carry the deployment's app name: `OS_APP_NAME`, else the configured `appName`, else `ObjectStack`. An explicitly set `branding.workspace_name` setting still outranks it.

Clause-②: no

- **Existing enrollments keep working.** The issuer is a display label. The stored enrollment holds only the encrypted secret, the backup codes and the confirmation flag, and the codes depend only on the secret, digits and period. An authenticator app enrolled under `Better Auth` keeps producing codes that verify. It keeps its old label until the user re-enrolls.
- **`@objectstack/plugin-auth`.** `AuthManager` passes its app name to better-auth as `appName`. In better-auth 1.7.3 that key names only these two otpauth URIs. No cookie name or stored value derives from it.
- **`@objectstack/cli`.** `objectstack serve` now passes the deployment app name to `AuthPlugin`. It is resolved by the same chain the email service's template context uses: `OS_APP_NAME` > `config.email.appName` > `config.email.defaultTemplateContext.appName` > `config.appName` > `ObjectStack`. Before, `serve` built `AuthPlugin` with no app name, so auth answered `ObjectStack` whatever `OS_APP_NAME` said. Auth emails were affected too: under `serve` they now name the deployment the way every other email already did.
- The issuer is read when the auth instance is built. A `branding.workspace_name` change made after that reaches new enrollments at the next restart or auth-settings change, while auth emails pick it up on their next send.
