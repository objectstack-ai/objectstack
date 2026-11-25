---
'@object-ui/console': patch
---

fix(console): the developer pages and the device sign-in approval send the stored sign-in token, so a session held by its token alone works there too

Clause-②: no
Metadata-protocol: none

The developer integrations page, the agent-connect section (discovery and creating an API key) and the device sign-in approval (claim, approve, deny) asked this server with the session cookie only, so a session held by its sign-in (bearer) token alone was refused there. They now send the stored token as well, as the other same-server console requests do. The session cookie is still sent, so a cookie session behaves exactly as before, and a refused request now reaches the console's session-ended check. Nothing changes in what the server accepts.
