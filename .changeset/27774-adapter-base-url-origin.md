---
'@object-ui/data-objectstack': patch
'@objectstack/skills': patch
---

fix(data-objectstack): `ObjectStackAdapter` reaches discovery from a `baseUrl` that ends in `/api/vN`, and the objectui skill teaches the server origin

Clause-②: no
Metadata-protocol: none

`new ObjectStackAdapter({ baseUrl: '/api/v1' })` — the form the published `objectui` skill taught — asked for `/api/v1/api/v1/discovery`, so `connect()` failed and every read and write that awaits it failed with it. The adapter's own search, data, export and meta reads already dropped a trailing `/api/vN`; discovery and the wrapped `ObjectStackClient` did not.

- The adapter now reads `baseUrl` as the server origin once, where it and its client are built: a trailing slash and a trailing `/api/vN` are dropped, so `''`, `http://host:3000`, `/api/v1` and `http://host:3000/api/v1` all reach `/api/v1/discovery` and the same `/api/v1/...` routes, through the client and through the adapter's raw reads alike. The five per-call suffix checks are gone; nothing else about the URLs changes.
- `skills/objectui` (`guides/data-integration.md`, `guides/auth-permissions.md`) and the package README teach the origin form the console passes (`''` behind a same-origin proxy, or the server origin), and the data-integration eval refuses an answer that writes `baseUrl: '/api/v1'`.
