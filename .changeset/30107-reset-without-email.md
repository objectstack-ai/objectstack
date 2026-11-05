---
'@objectstack/spec': patch
'@objectstack/plugin-auth': patch
---

`GET /api/v1/auth/config` now says whether email leaves the deployment, in a new optional `features.emailDelivery` flag. It is `true` only when the wired email service reports itself configured, and `false` with no email service or with the stock `log` transport, which writes mail to the server console instead of sending it. The forgot-password page can read it to stop saying a reset link was sent on a deployment that sends no mail.

The flag describes the deployment, not an address: `POST /api/v1/auth/request-password-reset` still answers a known and an unknown address the same way, with or without mail.

Clause-②: yes (widening)
Metadata-protocol: none
