---
'@objectstack/lint': patch
---

fix(lint): the `flow-credential-literal` explanation says the built-in providers run an `oauth2` / `app-credential` grant

Clause-②: no (lint advice is not a contract face; no accepted metadata shape moves)
Metadata-protocol: none

The `os explain` entry for `flow-credential-literal` said a grant-bearing instance is held degraded "until it runs that grant". The built-in `rest`, `openapi` and `mcp` providers now ask the per-dispatch credential handle, so an `oauth2` or `app-credential` instance on them is served (an `authorization_code` instance once an administrator connects it). The sentence now says so, and keeps the degraded case for a provider that does not ask the handle. No rule verdict, `fix:` line or hint changes.
