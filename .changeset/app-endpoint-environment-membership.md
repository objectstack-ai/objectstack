---
'@objectstack/runtime': patch
---

fix(runtime): a declared app endpoint runs the environment-membership check

Clause-②: yes (widening) — `@objectstack/runtime`'s published `HttpDispatcher` gains one public method, `environmentMembershipRefusal(context)`.
Metadata-protocol: none

On a multi-environment host that enforces environment membership, a declared app endpoint (`/api/v1/apps/…`) now answers a signed-in caller who is not a member of the environment the request resolves to with `403 PROJECT_MEMBERSHIP_REQUIRED`, as the built-in routes do, whether or not the endpoint sets `authRequired`. The check runs after the endpoint is matched and its policies admitted the caller, so a path no declaration owns keeps its `404` and an anonymous caller of an `authRequired` endpoint its `401`. Members, anonymous callers, and hosts without environment scoping or with the check turned off (`api.enforceProjectMembership: false`) are unchanged. `HttpDispatcher` gains `environmentMembershipRefusal(context)`, and `runAppEndpointStep` an optional `membership` input.
