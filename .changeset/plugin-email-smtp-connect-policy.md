---
'@objectstack/plugin-email': patch
---

feat(plugin-email): a host can decide where every SMTP transport the email plugin builds may connect, including transports built from saved mail settings

Clause-②: yes
Metadata-protocol: none

`EmailServicePlugin` takes a new constructor option, `smtpConnect` (`SmtpConnectPolicy`, exported with `SmtpConnectRequest` and `SmtpConnectCallback`). Its `getSocket` is asked for every connection of every SMTP transport the plugin builds: the one built at boot from `providerOptions` / `OS_EMAIL_SMTP_*`, the live one built from saved Mail settings, and the one a Mail settings "Send test email" press builds. It admits a connection by handing back the socket it opened, and refuses one with an error whose message is what the failed send and the test answer report. An answer without a socket fails the connection.

The policy is applied after any `transportOptions`. While it is set, an SMTP transport refuses at construction, naming the key, `transportOptions` carrying `send`, `proxy`, `url`, `sendmail`, `streamTransport`, `jsonTransport`, `SES`, `connection` or `socket`, a `tls` block that names a `socket`, or an OAuth2 `auth`. `SmtpTransportOptions` gains the matching `connect` field and `MakeTransportOptions` the matching `smtpConnect` field.

Without the option nothing changes: every SMTP transport hands nodemailer the same options as before, and those `transportOptions` keys behave as they always did.
