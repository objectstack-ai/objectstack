---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): Setup → Integrations → Connector Connections asks for the installer's OAuth client when an instance declares `clientSource: 'installer'`

Clause-②: yes
Metadata-protocol: none

An `oauth2` `authorization_code` connector instance whose declaration says `clientSource: 'installer'` takes the OAuth client the administrator registered with the vendor. Connect and Reconnect on such an instance now open a form for its client ID and client secret before the sign-in window opens; Continue begins the connect with `{ clientId, clientSecret }` (the secret omitted for a public client). The secret input is masked, starts empty on every opening and is cleared the moment the connect is sent; the stored secret is never read back. A connected instance shows which client it keeps (`OAuth client ID, secret stored`), and Reconnect prefills that client ID and sends the client again, because the server takes a client on every connect of such an instance. Every other instance connects with no form, as before.

Twelve new keys under `connectorConnections` in all ten `@object-ui/i18n` locales: `clientKeptWithSecret`, `clientKept`, `clientTitle`, `clientIntro`, `clientStored`, `clientStoredSecret`, `clientStoredNoSecret`, `clientResend`, `clientId`, `clientSecret`, `clientSecretHint`, `clientContinue`.
