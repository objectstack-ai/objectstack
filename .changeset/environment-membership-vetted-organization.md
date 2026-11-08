---
'@objectstack/runtime': patch
---

fix(runtime): the environment-membership check reads the organization a session's resolution vetted

Clause-②: no
Metadata-protocol: none

On a multi-environment host, the dispatcher does not ask a caller acting in the platform organization for environment membership. For a caller a session cookie admitted, that organization is now the one the request's resolution vetted, the same one every other door reads, and not the organization stored on the session. A session whose stored organization the resolution does not keep is checked like any other caller (`403 PROJECT_MEMBERSHIP_REQUIRED` when it is not a member of the environment). Callers an API key or an OAuth access token admitted are unchanged, and so are hosts without environment scoping and hosts that turn the check off (`api.enforceProjectMembership: false`).
