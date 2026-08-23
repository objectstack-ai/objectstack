---
"@objectstack/spec": patch
---

**Docs:** `APPROVER_ORG_SCOPED`'s docblock stops justifying `team: false` with "the engine never scoped it", which the team organization screen made false (#10548).

The docblock over `APPROVER_ORG_SCOPED` carried two clauses about `team`, and after #10230 they no longer agreed. "`sys_team_member` carries no organization column" is still true — it is still why a team's *members* are not individually placed. "the engine never scoped it" no longer described the engine: `expandTeamUsers` (`packages/plugins/plugin-approvals/src/approval-service.ts`) opens with `teamIsProvablyOutsideOrg`, which reads `sys_team`'s `organization_id` and drops the team when it names an organization other than the request's, at both of its call sites.

The **flag value is unchanged and deliberately so**. The table answers ADR-0105 D9 *retargetability* — "does an `organization:` declaration apply to this type" — and `team` still consults no org-scoped directory, so a declaration on it still has nothing to redirect and is still rightly refused by `resolveApproverDirectoryOrg`. Only the justification had drifted, by resting on an engine behaviour that has since changed. The replacement text says the flag is about **targeting, not tenancy**: org-agnostic for retargeting because no directory is consulted, and screened to the request's organization on the team's own `organization_id` regardless.

The risk repaired is the ordinary one for a load-bearing comment: the next reader deciding whether `team` needs an organization screen would find a spec docblock asserting the engine has none and conclude the work is outstanding when it has landed — or read the `team: false` / `manager: false` pairing as still marking "the unscreened types", which after #10153 and #10230 it does not.

Prose only: no schema shape, no `.describe()` text, no runtime behaviour, and no authorable-surface movement. It is graded rather than skipped because the text ships to consumers on **two** surfaces — `@objectstack/spec`'s `files` list publishes `src/**/*.zod.ts`, so the docblock travels in the npm tarball as source, and unlike a property-level comment inside a `z.object({ … })` literal, a docblock over a top-level `export const` survives declaration emit: the stale sentence is present in the built `dist/automation/index.d.ts` and `dist/automation/index.d.mts`, which is what a consumer's editor surfaces on hover.
