---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
'@object-ui/console': patch
---

feat(plugin-auth): a page navigation to the mobile sign-in hand-off that has to sign in first goes to the sign-in page, so the app opens only the hand-off

Clause-②: no
Metadata-protocol: none

`GET /api/v1/auth/one-time-token/handoff` answered a missing or old session with `401` as raw JSON, so the mobile app had to open the Console's `/login` route itself and know how that page treats `redirect`. An installed app stays in use for months, so a Console upgrade could strand it. Now the app opens only the hand-off:

- A page navigation with no session, or with one older than five minutes, answers `302` to this deployment's Console sign-in page, with `redirect` naming the same request. `Location` is root-relative, so the browser stays on the origin the request arrived on, and `uiBasePath` is honoured.
- Any other request still answers `401`, so the app's anonymous probe keeps reading "this server registered me". A navigation reporting `Sec-Fetch-Site: same-origin` answers `401` too: it is the sign-in page forwarding a session the route refuses. A deployment that does not serve the Console keeps the `401` too, and says so once at `warn`.
- A token is still minted only for a session under five minutes old, and every `400` (a cross-site navigation, an unknown parameter, an unregistered scheme, a bad challenge) is still decided first, with no redirect.
- A device whose clock is behind does not bounce between the route and the sign-in page. The redirect carries `handoff_refused_at`, the server's time of the refusal, and the page holds its form for any session not created after it, whatever the device's clock says. A session created after it forwards, so a provider's sign-in that returns to the same URL still ends at the app. The links between the sign-in and sign-up pages carry the mark beside a hand-off `redirect`, and every other link is unchanged.

An app can change its entry only once its server runs this release: an older server answers the new entry with JSON.
