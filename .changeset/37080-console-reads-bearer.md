---
'@object-ui/console': patch
---

fix(console): the developer pages and the device sign-in approval send the stored bearer token, so a session the rest of the console accepts works there too

Clause-②: no
Metadata-protocol: none

The developer integrations page, the agent-connect section (discovery and API key minting) and the device sign-in approval (claim, approve, deny) called this server's `/api/` routes with the session cookie only (`credentials: 'include'`). A session held by its bearer token alone was answered `401` there. They now go through `createAuthenticatedFetch` from `@object-ui/auth`, built per call, as every other console request does. The session cookie still rides along, so a cookie session behaves exactly as before, and a `401` now reaches the console's session-ended check. Nothing changes in what the server accepts.
