---
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
---

Correct a false vendor claim in the `organization/add-member` source comments:
`teamId` has **no** active-team fallback (#10532). Two comments — the
`sys_member` `add_member` action metadata (the origin) and the
`organization-add-member.ts` module header that cited it as authority — stated
that "organizationId/teamId default to the caller's active org/team when
omitted". Measured on the installed better-auth 1.7.1
(`dist/plugins/organization/routes/crud-members.mjs`, inside `addMember`), only
the organization half is true:

```js
const orgId = ctx.body.organizationId || session?.session.activeOrganizationId;
const teamId = "teamId" in ctx.body ? ctx.body.teamId : void 0;
```

`activeOrganizationId` is read 8 times in that module; `activeTeamId`, never. An
omitted `teamId` therefore stays `undefined` and the member joins no team — every
`if (teamId)` branch (team lookup, `TEAM_NOT_FOUND`, per-team limit) is skipped.

No runtime behaviour changes, and no deployment was ever misled: the `add_member`
action's `params` list carries no `teamId`, so the toolbar never sent one and the
claim was never exercised. What the comment did mislead was the next reader of
the mount, which cited it as the justification for forwarding request headers —
forwarding buys the organization default only. Forwarding `teamId` itself remains
correct: pass it and it works.

The asymmetry the docs now publish is held by a new pin,
`organization-add-member-team-fallback.test.ts`, which reads the fact out of the
installed vendor artifact (not out of our own comments) so that a future
better-auth bump *adding* an active-team fallback reddens instead of silently
putting the docs out of date.
