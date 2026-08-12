---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): invitations can be accepted again — adopt the existing membership instead of colliding on the unique index (#7725)

`POST /api/v1/auth/organization/accept-invitation` returned **HTTP 500 with an
empty body** and left the `sys_invitation` row `pending` **forever**. It was not
intermittent: on a single-organization deployment the flow in the docs — invite a
fresh email, invitee signs up through the link, invitee accepts — could never
complete at all, and the invitation was unrecoverable through the UI because
re-inviting an address that is already a member is refused too.

Two correct platform decisions collided:

- every user is auto-bound to the deployment's default organization at sign-up,
  by the membership reconciler (ADR-0093 D1/D2), and
- `sys_member` declares `{ organization_id, user_id }` unique.

better-auth's built-in accept-invitation route assumes an invitee is never
already a member: after flipping the invitation to `accepted` it inserts a
membership unconditionally, inside a transaction whose failure handler rolls the
invitation **back to `pending`** and rethrows. So the invitee's auto-bound row
made the insert fail, and the rollback erased the only evidence that acceptance
had been attempted.

Acceptance now **adopts** that row rather than minting a second one. The declared
unique pair is the identity of a membership, so a create naming a pair that
already exists is that membership. The invitation ends `accepted`, and the
invitee holds exactly one membership in the target organization.

**What adoption does to the role.** The invitation's role is written onto the
adopted row, so an invitation's intent is not silently replaced by the
reconciler's default `member` — accepting an `admin` invitation makes you an
admin even if you signed up first. One deliberate exception: **adoption never
lowers a grade.** If the existing membership already outranks the invitation's
role, the existing role is kept. Acceptance admits a person; demotion belongs to
`POST /organization/update-member-role`, which is the route the last-admin guard
stands on — without this exception, an organization's sole owner accepting a
`member` invitation would have been demoted past that guard, taking the
organization's last owner with it.

The membership's `created_at` is not rewritten (the membership really did begin
at sign-up), and the adoption is recorded in `sys_member` history attributed to
the person who accepted.

Unaffected: an invitee who is not yet a member of the target organization still
gets a membership created exactly as before, and the delegated-admin issuance
scope (ADR-0090 D12 / ADR-0105 D8) is untouched.
