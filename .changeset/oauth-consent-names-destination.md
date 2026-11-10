---
'@objectstack/plugin-auth': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(plugin-auth, console): the OAuth consent page names where the grant is sent and marks a client no account registered as unverified

Clause-②: yes (widening)
Metadata-protocol: none

The OAuth consent page shows, beside the name and logo the client declared at registration, two facts the server establishes from the authorization request it signed:

- **Where the grant goes.** A new session-required door, `POST /api/v1/auth/oauth-consent/request` with body `{ oauth_query }` (the signed query the provider sends the consent page), answers `{ clientId, redirectUri, registeredAnonymously }`. `redirectUri` is read from the request only after the provider's own signature check (`verifyOAuthQueryParams`, the check `/oauth2/consent` runs), so it is the redirect `/oauth2/authorize` validated and the one a consent sends the code to; it is never read from the client's registration metadata. A request this server did not sign, or whose signature expired, is `400 VALIDATION_ERROR`; a client the provider does not serve is `404 RESOURCE_NOT_FOUND`; the body takes `oauth_query` only. The page shows the redirect's host (with its port) for an `http(s)` redirect, a loopback one included, and any other redirect, such as a native app's custom scheme, as it is.
- **Whether anyone here registered the client.** `registeredAnonymously` is `true` when the stored client carries neither a `user_id` nor a `reference_id`: every registration door that takes a session records the caller, and a dynamic registration made with no credential records nobody. The page marks such a client as an unverified application and names the destination in the warning. A client registered through Setup, or by any signed-in account, is shown without the mark.
- **Authorize waits for the destination.** Until the server has answered, and whenever it cannot, Authorize is disabled and the page says the destination could not be confirmed. Deny always works.

The new strings ship in all 11 console locales (`en`, `zh-Hans`, `zh-Hant`, `ja`, `ar`, `de`, `es`, `fr`, `ko`, `pt-BR`, `ru`).
