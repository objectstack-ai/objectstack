---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an unconfigured auth origin now ends on the port the HTTP server actually bound

Clause-②: no
Metadata-protocol: none

With no auth base URL configured (`objectstack dev -p 0`, or a dev server that moved off a busy port), the auth origin used to stay on the requested port, `http://localhost:0` or `http://localhost:3000`, while the server listened on another one. Invite links, sign-in and password-reset mail then pointed at a port nothing served. The port is now read on `kernel:listening`, after the transport has bound it. A better-auth instance that a `kernel:ready` hook had already built on the old origin, such as the development admin seed's, is discarded and rebuilt on the bound origin at its next use. A configured base URL, `http://localhost` included, is still kept exactly as written.
