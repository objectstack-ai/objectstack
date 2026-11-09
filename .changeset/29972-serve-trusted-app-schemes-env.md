---
'@objectstack/cli': patch
---

fix(cli): `os serve` reads `OS_TRUSTED_APP_SCHEMES` into AuthPlugin's `trustedAppSchemes`, so a deployment can register its mobile app for the sign-in hand-off

Clause-②: no
Metadata-protocol: none

- **Before.** `serve` constructed `AuthPlugin` with no `trustedAppSchemes`, and no setting a deployment could make reached the key. The `one-time-token` plugin never mounted and `GET /api/v1/auth/one-time-token/handoff` answered `400 … is not a registered app scheme` for every app, whatever the operator set.
- **Now.** `OS_TRUSTED_APP_SCHEMES` is read the way `OS_TRUSTED_ORIGINS` is: comma-separated, each entry trimmed, empty entries dropped, repeats folded. The list is passed as `trustedAppSchemes`. `os dev` and `os start` run `serve` as a child with the inherited environment, so they read it through the same line.
- **Unset stays unset.** No default scheme is registered: unset, empty or only separators, the plugin stays unmounted and the hand-off refuses every target, as before.
- **A bad entry still fails the boot.** Entries are not validated, lower-cased or dropped by the reader; plugin-auth's `assertTrustedAppSchemes` refuses a bad one at construction, naming it.
- Environment variable only: no stack key is added. The hosted runtime's own `AuthPlugin` is not changed. Listed in `content/docs/deployment/environment-variables.mdx` beside `OS_TRUSTED_ORIGINS`.
