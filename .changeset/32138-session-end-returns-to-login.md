---
'@object-ui/auth': patch
---

fix(auth): a session that ended on the server now returns the Console to the sign-in page on the next in-app navigation, instead of reading every 401 as a missing page or a network fault

Clause-②: no
Metadata-protocol: none

When the session ended on the server (signed out elsewhere, expired, revoked), the Console kept the signed-in shell and answered each click with "Page Not Found" or "Couldn't load records … Check your connection", and only a full reload reached the sign-in page. Now a `401` answered to any API call made through `createAuthenticatedFetch` makes `AuthProvider` ask the server once whether a session is still held. When the server says there is none, the provider clears the session, and the route guard sends the visitor to `/login` with the current page as `?redirect=`, the same place a reload goes, so they sign back in where they were.

Nothing else changes: a `403` or a `404` renders as before and asks nothing; a `401` while the server still holds the session (one endpoint refusing one request) leaves the page alone; a re-check the server does not answer (transport error) keeps the session; and with no session held, on the sign-in page included, a `401` is ignored, so there is no redirect loop. A burst of `401`s from one navigation makes one re-check.
