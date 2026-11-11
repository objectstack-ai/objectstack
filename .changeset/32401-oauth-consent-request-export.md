---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): `runOAuthConsentRequestRead` and `oauthConsentRequestDepsFor` — a host that forwards `/api/v1/auth/*` to a kernel's `AuthManager` answers the OAuth consent page's request read

Clause-②: yes (widening)
Metadata-protocol: none

The package root now exports `runOAuthConsentRequestRead(deps, request)` and `oauthConsentRequestDepsFor(manager)`, with the types `OAuthConsentRequestManager`, `OAuthConsentRequestDeps`, `OAuthConsentRequestResult`, `OAuthConsentRequestData` and `ConsentRequestClient`. Together they are the whole body of `POST /api/v1/auth/oauth-consent/request`, the same two calls AuthPlugin's own mount makes; nothing in the module changes, so every answer and refusal is as before.

The Console's OAuth consent page keeps Authorize disabled until this route answers `200`. A host that serves no AuthPlugin routes and forwards the auth routes to an `AuthManager` it did not mount (a per-environment kernel with no HTTP server, AuthPlugin with `registerRoutes: false`) answered it `404`, so nobody could approve an MCP or other OAuth client there. Such a host now answers it for the manager it forwards to:

```ts
import { oauthConsentRequestDepsFor, runOAuthConsentRequestRead } from '@objectstack/plugin-auth';

const answer = await runOAuthConsentRequestRead(oauthConsentRequestDepsFor(authManager), {
  raw: request,          // the incoming Request, body unread
  queries,               // the request's query parameters, name to values
});
// answer.status is 200, 400, 401, 403 or 404; send answer.body as JSON with answer.headers
```
