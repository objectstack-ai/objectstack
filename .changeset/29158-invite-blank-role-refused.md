---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: `invite-member` refuses a blank role 400 `ROLE_NOT_FOUND`, the way it refuses an unknown one, and writes no invitation (#29158)

Clause-②: no (narrowing) — `POST /api/v1/auth/organization/invite-member` with a blank role (`""`, whitespace only, or an empty role array) answered 200 and stored the invitation; it is now refused 400 `ROLE_NOT_FOUND`. A role list with an empty entry (`"member,"`) was already refused 400 `VALIDATION_FAILED` by the `sys_invitation.role` select validator, and now answers 400 `ROLE_NOT_FOUND`. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the spec changes: the invite door now refuses a role value that names no role, with the code it already answers for an unknown role, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the invite door (`@objectstack/plugin-auth`).

- **Before.** better-auth's role check splits the role list and drops empty entries before it looks for unknown names, so a blank role named no unknown role and passed. A blank value (`""`, whitespace only, an empty role array) was then stored as the invitation's role (`role: ''`). A role list with an empty entry (`"member,"`) was refused 400 `VALIDATION_FAILED` (`invalid_option`) by the `sys_invitation.role` select validator, and was stored only on a composition without the ObjectQL validator. Under a walled `group` posture, accepting it wrote a membership with no organization role, whose holder read less than a member and gave the administrator no reason why. An unknown role such as `superuser` was already refused 400 `ROLE_NOT_FOUND`.
- **Now.** The framework's `beforeCreateInvitation` refuses a blank role first, before the invitation role cap and before any row is written: 400, `code: 'ROLE_NOT_FOUND'`, and a message that says the invitation role is empty. A blank role is refused, never defaulted to `member`.
- **Unchanged.** Every named role is judged as before: the vocabulary, the role cap's three refusals and the placement gate. A resend of an invitation that is already pending keeps the stored role, as before.
- **Who sees it.** A script or form that invites with an empty role: it now gets the refusal instead of an invitation outside the role vocabulary. Invitations already stored with a blank role are not rewritten.
- **Who sees it, by code.** A client branching on `error.code` sees `VALIDATION_FAILED` become `ROLE_NOT_FOUND` for a role list with a blank entry; the status (400) and the absence of a row are unchanged.

**The remedy.** Send the organization role the invitee joins with, for example `member`.
