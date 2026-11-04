---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
---

feat(plugin-auth): a page navigation to the mobile sign-in hand-off that has to sign in first goes to the sign-in page, so the app opens only the hand-off

Clause-②: no
Metadata-protocol: none

`GET /api/v1/auth/one-time-token/handoff` answered a missing or old session with `401` as raw JSON, so the mobile app had to open the Console's `/login` route itself and know how that page treats `redirect`. An installed app stays in use for months, so a Console upgrade could strand it. Now the app opens only the hand-off:

- A page navigation with no session, or with one older than five minutes, answers `302` to this deployment's Console sign-in page, with `redirect` naming the same request. `Location` is root-relative, so the browser stays on the origin the request arrived on, and `uiBasePath` is honoured.
- Any other request still answers `401`, so the app's anonymous probe keeps reading "this server registered me". A deployment that does not serve the Console keeps the `401` too, and says so once at `warn`.
- A token is still minted only for a session under five minutes old, and every `400` (a cross-site navigation, an unknown parameter, an unregistered scheme, a bad challenge) is still decided first, with no redirect.
- The redirect cannot bounce. It carries `handoff_refused_at`, the server's time of the refusal, for the sign-in page to judge a session by, and a same-origin navigation this route still refuses gets the `401`.

An app can change its entry only once its server runs this release: an older server answers the new entry with JSON.
