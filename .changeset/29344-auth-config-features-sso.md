---
'@objectstack/spec': minor
---

feat(spec): declare `features.sso` on the `GET /api/v1/auth/config` response

Clause-②: yes (widening)
Metadata-protocol: added

`AuthFeaturesConfigSchema` gains an optional boolean `sso`. The server has served it for a long time, and the console login form reads it to decide whether to show "Sign in with SSO", but the contract did not declare it. A client that parsed the response through `GetAuthConfigResponseSchema` lost the flag, because a plain object schema strips keys it does not know.

- **What the value means.** `true` when enterprise SSO is usable: the SSO plugin is wired and at least one SSO provider is configured. `false` when SSO is off, or on with no provider yet. The `/auth/config` route answers this "usable" value, not the coarser "wired" flag, and falls back to "wired" when providers cannot be counted.
- **How it differs from `ssoEnforced`.** `ssoEnforced` takes the password form away. `sso` only says whether the SSO entry exists.
- **Absent** means not usable. The schema sets no default.

What to do: nothing. Every payload accepted before is accepted unchanged. A client that typed the response from `@objectstack/spec` (for example through `@objectstack/client`'s re-exported `AuthFeaturesConfig`) now sees `sso?: boolean`.
