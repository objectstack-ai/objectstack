---
'@objectstack/core': patch
'@objectstack/mcp': patch
'@objectstack/objectql': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
'@objectstack/service-storage': patch
---

feat(security): an AI service account is the agent principal of its own requests, under the agent ceiling (ADR-0151 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

An AI service account (a `sys_user` row whose `principal_kind` is `agent`) now acts as itself. Its API key, on REST, on `/mcp` and over stdio, admits a context whose `userId` is the account, with `principalKind: 'agent'` and no `onBehalfOf`. Its own grants are its whole authority:

- It does not receive the `everyone` anchor's permission sets or the member baseline. Its floor is the restricted agent set, so a new account can do nothing until it is granted something.
- It carries no system permission and is never a platform or organization administrator, whatever it holds.
- Every agent principal's permission sets are read under the agent ceiling: no View All, no Modify All, no transfer, restore or purge, no system permission and no admin scope. A set edited after it was assigned still grants nothing above the ceiling. The permission sets an OAuth-connected assistant receives carry none of these bits, so it is unchanged.
- Assigning an account a permission set, or a position whose sets, carry any of those bits is refused `400 VALIDATION_FAILED` (`invalid_value`), naming the set and what in it is above the ceiling.

Flow runs, attachment and comment access checks, mention checks and the access explainer read the account as the agent it is. A person's sign-in, keys and grants are unchanged.

Nothing registers an AI service account yet; the registration, key and lifecycle doors follow in a later change.
