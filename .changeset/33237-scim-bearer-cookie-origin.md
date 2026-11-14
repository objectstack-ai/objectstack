---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a SCIM bearer write that carries a Cookie and no Origin is no longer refused 403 `MISSING_OR_NULL_ORIGIN`

Clause-②: no
Metadata-protocol: none

better-auth's origin check requires an `Origin` (or `Referer`) whenever a request carries any Cookie, and `AuthManager.handleRequest` used to forward the Cookie into it on `/scim/v2/*`. An identity provider that keeps a cookie jar, or sits behind an edge cookie (`__cf_bm`) or a sticky-session load-balancer cookie, was therefore answered 403 `MISSING_OR_NULL_ORIGIN` on every `POST /Users` and every `PATCH … active:false`: it could neither provision nor deprovision a user.

SCIM authenticates by the `Authorization: Bearer` credential alone and its writes are attributed to the verified connection, so a Cookie carries no authority on that path. `handleRequest` now drops the Cookie from a `/scim/v2/*` request that carries a bearer, before better-auth sees it. No check is relaxed: every other route, and a `/scim/v2/*` request with no bearer, still reaches the origin check with its Cookie and is still refused without an `Origin`. A deployment that strips the Cookie in front of the server for this reason can drop that strip once it runs this release.
