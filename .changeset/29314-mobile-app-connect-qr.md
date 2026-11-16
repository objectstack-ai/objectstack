---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
'@objectstack/plugin-auth': patch
---

feat(console): a Mobile App page in the account app shows the code that connects the ObjectOS mobile app to this server

Clause-②: yes (widening) — a new account-app navigation entry and component (`account:mobile_app`), a new `mobileApp` namespace in the `@object-ui/i18n` packs, and a new optional `features.publicBaseUrl` served on `GET /api/v1/auth/config` (declared in `AuthFeaturesConfigSchema`, registered in `PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS`, typed on `AuthPublicConfig`); nothing that worked before is refused
Metadata-protocol: none

The account app (avatar menu → Profile) gains a **Mobile App** entry after Profile. Its page shows a QR code that encodes `objectos://connect?server=<this server's public base URL, URL-encoded>`, the same link as copyable text, and one line saying the code holds only the server's address, never the account.

`GET /api/v1/auth/config` now serves `features.publicBaseUrl`: the base URL the auth layer builds every link from (`OS_AUTH_URL`, then `BETTER_AUTH_URL`, then `OS_BASE_URL`), with any sub-path mount, as an address only (scheme, host and path; a credential, query or fragment in the setting is never served). The page encodes that URL. The page normalises it the same way again before use, so the code carries the server's address and nothing else. The browser's own address is never used, because it can be an internal or proxied host. When that URL names `localhost` or a private address, or a public host on plain `http:` (the mobile app signs in through it, so it must be HTTPS), the page shows no code and says how to fix it: set `OS_AUTH_URL` on the server to its public `https://` address and restart it. A server that does not publish the field gets a page saying it does not offer this yet.

No app-store links are shown: no setting carries them today.
