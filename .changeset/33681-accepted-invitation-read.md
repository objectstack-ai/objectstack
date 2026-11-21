---
'@objectstack/plugin-auth': patch
---

feat(plugin-auth): a signed-in recipient who opens an invitation they already accepted can read which organization it joined them to

Clause-②: yes (widening)
Metadata-protocol: none

The widening is one new route, `GET /api/v1/auth/organization/accepted-invitation?id=…`, added on better-auth's organization plugin (so it is served wherever that plugin is on, cookie and bearer sessions alike). Nothing is removed or narrowed, and no existing route answers differently.

better-auth's own `GET /organization/get-invitation` refuses every invitation that is not pending (accepted, rejected, canceled, expired) with the same code-less `400 "Invitation not found!"` it gives an unknown id, and `list-user-invitations` lists pending invitations only. So a person who accepted an invitation and opened the link again could not be told that they had joined. The new route answers exactly that case: when the invitation is `accepted` and the signed-in user is its recipient (the invitation's address equals the session's address, compared lowercase, and that address is verified), it answers `200 { success: true, data: { invitationId, status: 'accepted', organizationId, organizationName, organizationSlug, isMember } }`, where `isMember` says whether the person still belongs to the organization.

Every other case answers one `404 RESOURCE_NOT_FOUND` body, decided after the same single invitation read: an unknown id, another signed-in user (whatever the invitation's state), a recipient whose address is not verified, and the recipient's own pending, rejected, canceled or expired invitation. A caller with no session gets `401 UNAUTHENTICATED`. The query set is closed: `id`, once.

`get-invitation` answers byte for byte as before for every caller and state, and the signed-out `invitation-preview` stays session-blind and uniform.
