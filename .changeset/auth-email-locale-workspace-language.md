---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): bind the auth email locale to the workspace language, not the build-time default (#14319)

Auth mail (verification, password reset, invitation, magic link, email-change
notice) picked its `sys_email_template` row from
`II18nService.getDefaultLocale()` alone — the app artifact's **build-time**
`i18n.defaultLocale`, which is the bare `en` unless the app declares otherwise.
The workspace's **runtime** language, `localization.locale` (ADR-0053, Setup ▸
Localization), was never consulted, even though the very same `kernel:ready`
pass already reads it a dozen lines earlier to localize auth SMS, and the four
options that setting offers are exactly the four locales the auth templates
ship rows for.

A workspace that switched itself to Chinese therefore received Chinese OTP
texts and English verification mail from one plugin, on one boot.

`AuthPlugin` now prefers `localization.locale` whenever the operator has
**explicitly** set it (`ResolvedSettingValue.source !== 'default'`) — the same
precedence the sibling `branding.workspace_name` binding uses — and keeps the
build-time `i18n.defaultLocale` standing underneath it, so a deployment that
declared one is not demoted to the manifest default `en-US`. Neither producer
answering leaves the locale unnamed, which is `EmailService`'s documented
`en-US` fallback. The binding live-rebinds on `localization` settings changes,
exactly as the SMS one does.

The 2026-08-13 ruling is unchanged: the recipient locale is the deployment
default, resolved at the plugin layer; `Accept-Language` stays rejected and
there is still no per-user locale.
