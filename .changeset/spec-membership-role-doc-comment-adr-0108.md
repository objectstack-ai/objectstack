---
"@objectstack/spec": patch
---

docs(spec): `MemberSchema.role` / `InvitationSchema.role` stop naming `guest` a membership role (#7740)

Doc-comment and `.describe()` text only — no schema, no validation, no runtime
behaviour changes.

Both doc-comments in `packages/spec/src/identity/organization.zod.ts` described
the membership role vocabulary as `'owner' | 'admin' | 'member' | 'guest'`, "can
be customized per application". Neither half is true any more. Under ADR-0108 the
vocabulary is **closed** and is `owner`, `admin`, `delegated_admin`, `member`
(`BUILTIN_MEMBERSHIP_ROLES` / `BUILTIN_MEMBERSHIP_ROLE_OPTIONS` in
`./membership-role.ts`, which is what `sys_member.role` and
`sys_invitation.role` register as their select options). Nothing widens the list
at boot, `guest` is refused at better-auth's role check with `ROLE_NOT_FOUND`
before any row is inserted, and a stack that needs another business role declares
a `position` — the routes
`packages/qa/dogfood/test/membership-role-vocabulary.dogfood.test.ts` already
pins.

The text is worth correcting rather than leaving to rot: it is the most
reachable description of the field, and it demonstrably propagated — the
`identity-auth.org-membership-team-management` platform-checklist item named the
same wrong four roles, which is how the identity-auth QA run (#7663) found this.
Both are fixed in the same change.

`role` stays typed `z.string()`: the wire shape mirrors better-auth's own column.
That is now said explicitly in the comment, so the loose type is not re-read as
evidence that the set is open. The reference page generated from these
`.describe()` strings (`content/docs/references/identity/organization.mdx`) is
regenerated to match.
