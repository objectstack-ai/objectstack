---
'@objectstack/core': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

harden(data): changing an API key through the data door requires a signed-in session

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` names `sys_api_key` or teaches managing a key with an API key, and the docs teach key revocation and rotation from the API Keys list (`content/docs/ai/connect-mcp.mdx`, `content/docs/api/error-catalog.mdx`), a signed-in surface; every taught use stays true.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime write door: the generic data door stops taking writes to `sys_api_key` from a request an API key authenticated, and the remedy is to make the same change from a signed-in session, never a rewrite of anyone's code or metadata. No exported declaration is removed or narrowed (one export is added to `@objectstack/core`); all three packages publish; no ADR-0087 id is named or touched. -->

**BREAKING** (an accept-set narrowing).

Managing API keys is a signed-in-session act on every data door, as minting one through `POST /api/v1/keys` is. An API key keeps acting as its owner for data, automation and MCP.

**FROM.** The generic data door judged a write to `sys_api_key` by the row and column rules alone, whichever credential authenticated the request.

**TO.** A write to `sys_api_key` from a request an API key authenticated is refused `403 PERMISSION_DENIED`, and nothing is written. The message tells the caller to sign in and manage the key from the API Keys page.

- **Who is affected.** Only a script or integration that changed `sys_api_key` rows through `/api/v1/data/sys_api_key` while authenticated with an API key. **Fix:** make the change signed in, from the API Keys list (Account → Developer), or with a session cookie or session bearer token.
- **What does not change.** A signed-in session manages its own keys from the list as before, and the existing rule on who restores a key a forced password reset revoked is unchanged. Reading `sys_api_key` is unchanged. System-context writes (the mint, the last-used stamp, the forced reset) are untouched. An operation the object does not expose keeps its `405 OBJECT_API_METHOD_NOT_ALLOWED`.
- **Where it is decided.** One rule, `apiKeyManagementCredentialRefusal` (new export of `@objectstack/core`), asked at each data door's per-object gate: `RestServer`'s data routes and the runtime dispatcher's data faces. It reads which credential authenticated the request from the shared request resolver (`onAdmission`); the `ExecutionContext` shape is unchanged.
- **Embedders calling `HttpDispatcher` data handlers directly.** The rule is positive on the credential: a context with no `admission` keeps today's answer.
