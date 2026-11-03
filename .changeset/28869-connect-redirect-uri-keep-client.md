---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the installer OAuth client form shows the deployment's redirect URI, and a reconnect keeps the stored client unless it is replaced

Clause-②: yes
Metadata-protocol: none

On Setup → Integrations → Connector Connections, the client form of an instance declaring `clientSource: 'installer'` now shows the redirect URI to register with the vendor's OAuth client, exactly as the connection read answers it (`redirectUri`), with a Copy button. When the read answers none (the deployment has no `OS_BASE_URL` or `OS_AUTH_URL` to derive it from), the form says so and shows no URI; nothing is guessed from the browser's address. A reconnect of a connection that keeps an installer client now keeps it by default: the connect is begun with no body and the server reuses the stored client and secret. "Replace the stored client" shows the client ID (prefilled) and an empty secret field and sends the new client. After a disconnect, the page re-reads the connection, so the next Connect still shows the redirect URI.

`@object-ui/i18n`, under `connectorConnections` in all ten locales: eight new keys (`redirectUriLabel`, `redirectUriCopy`, `redirectUriCopied`, `redirectUriHint`, `redirectUriMissing`, `clientKeepHint`, `clientKeep`, `clientReplace`), and reworded values of `clientIntro` (now points at the redirect URI below instead of the documentation) and `clientResend` (now the replace hint). No key is removed.
