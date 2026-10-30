---
'@objectstack/service-settings': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/plugin-email': patch
---

fix(service-settings): Setup → Settings help says what a setting does in business words, and Country is a picker that shows names and stores the code

Clause-②: no
Metadata-protocol: none

An administrator in Setup → Settings read help written like code comments. It now names the effect, and the technical detail stays in the deployment docs.

- **Authentication.** The help names the Self-registration audience by the labels the page shows (Invitation only, Allowlisted email domains, Open), not by their stored keys. It no longer quotes env var names (the email-verification override, the Google client ID and secret), the stack-config paths, the API-key error codes or permission-set API names; it says "set in the server configuration" instead.
- **Feature Flags.** The beta banner says a feature set in the server configuration is locked for the whole deployment, without quoting an env var.
- **Mail.** The durable-queue help no longer names the queue's object, and the Send-test-email result for a log-only provider says the message was "kept in the email log" (`@objectstack/plugin-email`).
- **Webhooks.** The `sys_webhook` description, shown as the Webhooks subtitle, says what a webhook is without `defineStack` / `defineWebhook()` or the auto-enqueuer (`@objectstack/plugin-webhooks`).
- **The inherited-value badge** names the layer "Organization" (组织 / 組織 / Organización) instead of "Tenant".
- **Country pickers.** Company → Country and Localization → Default country are `select`s whose options are every ISO 3166-1 alpha-2 code with its name, in each shipped locale (`Germany (DE)`, `德国 (DE)`). The stored value is still the code, a stored code is one of the options, and the `iso_3166_alpha2` value domain stays the enforcement boundary, so the set of accepted values is unchanged. The names come from `Intl.DisplayNames`; the codes come from the shared `ISO_3166_ALPHA2_CODES`.

Every shipped pack (en, zh-CN, ja-JP, es-ES) carries the same wording.
