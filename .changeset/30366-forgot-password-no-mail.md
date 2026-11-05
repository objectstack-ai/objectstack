---
'@object-ui/auth': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(auth): the forgot-password page no longer says a reset link was sent on a deployment that sends no mail (#30366)

Clause-②: yes (widening)
Metadata-protocol: none

`GET /api/v1/auth/config` reports `features.emailDelivery`: `false` when no email service is wired or the stock `log` transport only writes mail to the server console. On such a deployment the forgot-password form used to answer every request with "Check your email — we've sent a password reset link", although no mail leaves. When the server reports `emailDelivery: false`, the success screen now says a reset link can't be emailed here and to ask an administrator, who can set a new password from Setup → Users.

The text describes the deployment, never the address: it carries no address, and a known and an unknown address read the same, so the page adds no account-existence oracle. Only an explicit `false` changes it; a server that predates the flag (no `emailDelivery` key) or a failed config fetch keeps the "check your email" screen, since those deployments may well send mail.

`ForgotPasswordFormLabels` gains `noDeliveryTitle` and `noDeliveryDescription`, and `AuthPublicConfig.features` gains `emailDelivery`. New strings `auth.forgotPassword.noDeliveryTitle` and `auth.forgotPassword.noDeliveryDescription` in all ten locales, passed by the Console's forgot-password page and `DefaultForgotPasswordPage`.
