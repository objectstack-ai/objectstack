---
'@objectstack/platform-objects': minor
'@objectstack/plugin-auth': minor
---

`sys_session.revoke_reason` accepts `organization_membership_ended` — "Remove member" now actually signs the person out

Removing a member deleted the `sys_member` row and left the session alive, for up to seven
days. #15409 closed the security half per request (a session whose `activeOrganizationId`
is not backed by a membership resolves with no active organization). This is the courtesy
half an admin was promised, and it is **never the enforcement**: a trigger can be missed,
an evaluation cannot.

- **New `revoke_reason` value, `organization_membership_ended`** — an accept-set widening
  on a published system object, hence `minor` on `@objectstack/platform-objects`. Every
  reason before it is a timer (`idle_timeout`, `absolute_max`, `concurrent_cap`) or an
  interactive revoke (`user_revoked`, `admin`); this is the first authorization-event
  cause. There is no Zod enum behind the column — it is free `text` — so the field's own
  description is the published vocabulary, and that is where the value is declared. The
  string deliberately matches the one the API-key arm of the same ruling family already
  mints for this event (`authRefusal.reason` in `resolve-authz-context.ts`), so one grep
  finds every place the platform acts on a membership ending.
- **The trigger acts on the ORGANIZATION'S CLAIM, never on the user** (maintainer ruling,
  decision batch #49 item 4, option B). A user who still holds another membership is
  **re-pointed** to it — never signed out of organizations they legitimately belong to. A
  user with no remaining membership has their session revoked through the existing
  `revoked_at` / `revoke_reason` mechanism, which expires it in place: better-auth returns
  nothing on the next request and the Console's existing 401 → login redirect handles it,
  with **no client change**.
- **The seam is an engine hook on `sys_member`**, not a hook on better-auth's
  `/organization/remove-member`. A census measured that the endpoint, a direct delete, a
  bulk delete, the cascade from a `sys_user` delete and an organization re-point all reach
  the hook, while an endpoint hook would have reached one of them. Same precedent as
  `last-admin-guard.ts`.
- **New public surface on `@objectstack/plugin-auth`** — `MEMBERSHIP_ENDED_REVOKE_REASON`,
  `endSessionClaimsForEndedMembership` and `registerMembershipEndedSessionTrigger`, hence
  `minor` rather than `patch`.

Known open by measurement, not by omission: a raw driver delete bypasses the trigger
entirely, and cloud's package-uninstall sample-data purge is one (filed as cloud#2003). The
per-request check covers it; the courtesy does not.
