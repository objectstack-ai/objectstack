---
"@objectstack/plugin-auth": minor
---

feat(auth): `onInvitationAccepted` host seam — better-auth's
`afterAcceptInvitation` forwarded to the host (ADR-0105 D8 prerequisite)

An invitation may carry placement intent (target business unit + positions,
extension fields on `sys_invitation` per the ADR-0092 whitelist), but there
was no server-side seam to apply it when the invitation is accepted —
better-auth's org-plugin models don't fire core `databaseHooks` (framework
#3541 D8 note).

`AuthManagerConfig.onInvitationAccepted` mirrors `onOrganizationCreated`:
invoked from `organizationHooks.afterAcceptInvitation` with the mapped ids
(`invitationId`, `organizationId`, `userId`, `memberId`, `role`, `email`)
plus the RAW `invitation` / `member` rows so a host reads its own extension
columns without a second query. Failure-isolated — acceptance never rolls
back on a side-effect miss; hosts needing effectively-atomic placement
should make the callback idempotent and reconcile on retry.
