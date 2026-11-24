---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): Settings, Packages, Audit Log and the connector pages send the stored bearer token, so a session the rest of the console accepts works there too

Clause-②: no
Metadata-protocol: none

These Setup surfaces called their endpoints with the session cookie only (`credentials: 'include'`), while the rest of the console sends the stored bearer token through its authenticated fetch. A session held by its bearer token alone (a second local runtime on the same host replaced the cookie, the cookie was blocked as a third-party cookie, or the cookie jar was cleared) therefore worked everywhere except here, where each page printed the server's `401` instead: "Authentication is required to access this endpoint.", a bare `UNAUTHENTICATED`, or, on the Audit Log, the raw response body followed by "No audit entries".

They now go through `createAuthenticatedFetch` from `@object-ui/auth`, the path every other console request takes: every `/api/settings` call and the judged client-address read of the Authentication and Access policy pages, the Audit Log read, the connector credential and connection doors, the Packages list (the Installed Apps address included) and the session's held package list, and this runtime's own install ledger (`/api/v1/marketplace/install-local*`) and cloud-connection reads (`installed`, `org-packages`). The session cookie still rides along (`credentials: 'include'` is unchanged), so a cookie session behaves exactly as before, and a `401` now reaches the console's session-ended check as it does on every other page. Nothing changes in what the server accepts.

A failed Audit Log read no longer draws the "No audit entries" empty state, and its alert shows the refusal's own sentence when the response envelope carries one, or "Failed to load audit log" otherwise, never the raw response body.
