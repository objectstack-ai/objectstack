---
'@objectstack/runtime': patch
---

fix(runtime): the environment-membership check judges the principal the request resolved

Clause-②: no
Metadata-protocol: none

On a multi-environment host, the dispatcher refuses a caller who is not a member of the environment a scoped route resolves to (`403 PROJECT_MEMBERSHIP_REQUIRED`). That check now judges the principal the request resolved, whichever credential admitted it: a principal admitted by an OAuth access token on `/mcp` or by an API key is judged as that token's user or that key's owner, in the organization its resolution vetted, including when a session cookie for another user is sent beside it. A principal admitted by a session cookie is judged as before. Hosts without environment scoping, and hosts that turn the check off (`api.enforceProjectMembership: false`), are unchanged.
