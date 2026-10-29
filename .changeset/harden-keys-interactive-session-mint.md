---
'@objectstack/runtime': patch
---

harden(keys): minting an API key requires an interactive session

Clause-②: no
Metadata-protocol: none

`POST /api/v1/keys` now creates a key only for a caller that a signed-in session authenticated. A request authenticated with an API key (`x-api-key`, `Authorization: ApiKey …` or `Authorization: Bearer osk_…`) is refused `403 PERMISSION_DENIED` on every verb, and nothing is written. A session cookie sent beside the key does not change that: the key is the credential that authenticated the request.

- **Who is affected.** Only a script or integration that called `POST /api/v1/keys` (or the SDK's `client.keys.create()`) with an API key. Signing in and creating the key from the API Keys page or the Connect an Agent page, or calling the route with a session cookie or session bearer token, works as before. A key keeps acting as its owner for data, automation and MCP.
- **What the refusal says.** The error envelope's `code` is `PERMISSION_DENIED`, the same code the route already answers when a caller is not a member of their active organization, and the message tells the caller to sign in and create the key there.
- **Embedders calling `HttpDispatcher.handleKeys` directly.** The handler reads which credential authenticated the caller from `HttpProtocolContext.admission`, which `dispatch()` fills during its identity step. A context passed in with no `admission` is refused as well. Set `admission: { credential: 'session', authGate: undefined }` only for a principal your host authenticated with a signed-in session.
