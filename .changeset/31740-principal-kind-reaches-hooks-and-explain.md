---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
---

feat(spec,objectql,plugin-security): a hook reads which kind of principal is calling, so an AI service account is recognised as the agent it is

Clause-②: yes (widening)
Metadata-protocol: added

A hook now reads `ctx.session.principalKind`, the request's own principal kind (`human`, `agent`, `service`, `guest` or `system`) copied verbatim from the execution context (ADR-0151 D5). Until now a hook could tell an agent acted only from `ctx.provenance.performedByClientId`, which only an OAuth client acting for a person carries, so an AI service account acting as itself looked like a person. Both kinds of agent now read `agent`; `performedByClientId` still tells them apart (set for an OAuth client, absent for an account, whose `userId` is the account itself).

A person reads `human` through every door. The key is absent when the execution context carries no kind (a programmatic or system call), which the execution context reads as `human`; it is never defaulted, so a context that lost its kind cannot report an agent as a person. A kind alone never creates a session. It is descriptive only: authorization stays with the security service, which already clamps an agent to its ceiling before any hook runs.

An administrator's explanation of another user (`?userId=` on the access explain) now names a person's `principal.principalKind` as `human`, matching the explanation they get of themselves; an AI service account already read `agent`.

Audit rows are unchanged: an AI service account's writes, action calls and data exports already record the account as `user_id`, with no `performed_by`, no `on_behalf_of` and no kind column (ADR-0118 D5).

Nothing to migrate: a hook that does not read the key sees no change.
