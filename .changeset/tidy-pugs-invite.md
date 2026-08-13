---
'@objectstack/plugin-auth': patch
---

`POST /api/v1/auth/organization/remove-member` now answers a permission denial
as `403 YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER`, matching its sibling
endpoints (`organization/update-member-role`, `organization/update`,
`organization/delete`, `organization/invite-member`).

It previously answered `400 YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`
— a message whose every clause could be false at once: the caller was not
leaving, was not an owner, and the organization could hold any number of owners.
better-auth orders its "only an owner may remove an owner" rule ahead of the
route's real permission check and reports it with the sole-owner invariant's
code and status, so the invariant answered a question it was never asked. The
removal itself was always correctly refused; only the response was wrong.

The genuine sole-owner refusal is unchanged and still fires when a sole owner
removes themselves or calls `organization/leave`, and every legitimate
owner-removes-owner / owner-removes-member path still returns `200`.
