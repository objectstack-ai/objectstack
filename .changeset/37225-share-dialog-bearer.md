---
'@object-ui/components': patch
---

fix(components): the share dialog lists, creates and revokes share links through the host's authenticated fetch, so a session held by its sign-in token alone sees its links

Clause-②: no
Metadata-protocol: none

`ShareDialog` asked this server for a record's share links (and created and revoked them) with the session cookie only. A session held by its sign-in (bearer) token alone (a cross-site embed, a cookie the browser blocked as third-party) was refused there: the dialog showed an error and no links. It now sends through the host's authenticated fetch, the `apiFetch` a host hands `SchemaRendererProvider` (the console's sends the stored token), as the renderers' own reads already do. The session cookie is still sent, a cookie session behaves exactly as before, and in the console a refused request now reaches its session-ended check. A host that mounts no provider keeps the plain `fetch`, as before. The `fetchHeaders` prop is unchanged.
