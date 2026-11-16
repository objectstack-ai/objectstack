---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/auth': patch
'@objectstack/platform-objects': patch
---

feat(console): a Mobile App page in the account app shows the code that connects the ObjectOS mobile app to this server

Clause-②: yes (widening) — a new account-app navigation entry and component (`account:mobile_app`), a new `mobileApp` namespace in the `@object-ui/i18n` packs, and `features.publicBaseUrl` declared on `AuthPublicConfig`; nothing that worked before is refused
Metadata-protocol: none

The account app (avatar menu → Profile) gains a **Mobile App** entry after Profile. Its page shows a QR code that encodes `objectos://connect?server=<this server's public base URL, URL-encoded>`, the same link as copyable text, and one line saying the code holds only the server's address, never the account.

The server URL is the one the server publishes as `features.publicBaseUrl` on `GET /api/v1/auth/config`: the base URL the auth layer builds every link from (`OS_AUTH_URL`, then `BETTER_AUTH_URL`, then `OS_BASE_URL`), with any sub-path mount. The code carries that URL normalised to its scheme, host and path: a username, password, query or fragment in the setting never reaches the code, the link or the page. The browser's own address is never used, because it can be an internal or proxied host. When that URL names `localhost` or a private address, or a public host on plain `http:` (the mobile app signs in through it, so it must be HTTPS), the page shows no code and says how to fix it: set `OS_AUTH_URL` on the server to its public `https://` address and restart it. A server that does not publish the field gets a page saying it does not offer this yet.

No app-store links are shown: no setting carries them today.
