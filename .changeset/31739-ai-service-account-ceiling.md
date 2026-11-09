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

feat(security)!: an AI service account is the agent principal of its own requests, under the agent ceiling (ADR-0151 D3)

Clause-②: no (narrowing) — every agent principal's permission sets are now read under the agent ceiling (no View All, no Modify All, no transfer, restore or purge, no system permission, no admin scope). The OAuth-connected assistant's first-party sets carry none of these bits, so only a deployment that edited its own agent set to carry one sees a narrower answer. No door, request or response shape, error code or status changes.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of a package root is removed or retyped. The narrowing reads only agent principals' permission sets at evaluation and refuses one class of assignment write; there is no stored shape for a migration to rewrite and no tombstone. -->

**BREAKING** for an agent principal whose permission sets carry View All, Modify All, a destructive grant (transfer, restore, purge), a system permission or an admin scope. Measured first-party: 0 (none of the 3 OAuth agent ceiling sets carries any of these bits, and no AI service account row can exist until registration lands).

- **Before.** An agent principal's sets were applied as written.
- **Now.** Those bits are cleared when the sets are read, and assigning such a set (or a position binding one) to an AI service account is refused by name.
- **The remedy.** Grant the agent the CRUD bits it needs on the objects it reads; a bypass bit or an administrative grant is a person's to hold.

An AI service account (a `sys_user` row whose `principal_kind` is `agent`) now acts as itself. Its API key, on REST, on `/mcp` and over stdio, admits a context whose `userId` is the account, with `principalKind: 'agent'` and no `onBehalfOf`. Its own grants are its whole authority:

- It does not receive the `everyone` anchor's permission sets or the member baseline. Its floor is the restricted agent set, so a new account can do nothing until it is granted something.
- It carries no system permission and is never a platform or organization administrator, whatever it holds: it never carries `admin_full_access` or an organization administrator set at all, so no reader that judges standing by a set's name (the approvals override and the `admin_rescue` slate among them) counts it.
- Every agent principal's permission sets are read under the agent ceiling: no View All, no Modify All, no transfer, restore or purge, no system permission and no admin scope. A set edited after it was assigned still grants nothing above the ceiling. The permission sets an OAuth-connected assistant receives carry none of these bits, so it is unchanged.
- Assigning an account a permission set, or a position whose sets, carry any of those bits is refused `400 VALIDATION_FAILED` (`invalid_value`), naming the set and what in it is above the ceiling.

Flow runs, attachment and comment access checks, mention checks and the access explainer read the account as the agent it is. A person's sign-in, keys and grants are unchanged.

Nothing registers an AI service account yet; the registration, key and lifecycle doors follow in a later change.
