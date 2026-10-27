---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation says a `runAs: 'system'` flow is refused identity-assignment writes, and names the remedy

Clause-②: no
Metadata-protocol: none

- **Before.** The `runAs: 'system'` guidance called system context the trusted-writer channel and never said that a system flow's insert, update, delete, transfer, restore or purge of `sys_user_position`, `sys_user_permission_set`, `sys_invitation` or `sys_member` is refused with `PERMISSION_DENIED`. An agent following the skill wrote a system flow to grant a permission set and met the refusal at run time.
- **Now.** A paragraph beside "Elevate the write, not the flow" states the refusal, says a dedicated system subflow does not lift it, and gives the remedy the refusal prescribes: grant positions and permission sets from a flow whose `runAs` is `'user'`, judged by the delegated-administration gate as the user it acts for; change invitations and memberships through the organization endpoints. Eval 11 in `evals/flows-triggers-approvals.json` checks that an answer routes such a grant through a `runAs: 'user'` flow.
- No schema, key or behaviour changes.
