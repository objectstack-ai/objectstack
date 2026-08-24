---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

Surface the email-invite entry on the organization record page's default
Members tab, and stop it rendering as a twin of "Add Member"

The in-shell Team surface (`sys_organization` record page, ADR-0081) opens on
tab-0 **Members**, whose related-list toolbar carried exactly one action —
`add_member`, which attaches an **already-registered** user by id. The
email-invite entry, `invite_user`, was declared only on `sys_invitation` and
`sys_user`, so it appeared only on tab-1 Invitations. An admin looking to
"invite a teammate by email" landed on Members, found no invite affordance and
concluded the product had none. The delivery half worked the whole time
(`sendInvitationEmail`, template `auth.invitation`) — only the door was in
another room.

`sys_member` now declares its own `invite_user` on `list_toolbar`, ahead of
`add_member`: same endpoint (`/api/v1/auth/organization/invite-member`), same
email + role inputs, and the same `requiresFeature: 'organization'` capability
gate as the other two mirrors. Declaration order is render order in the
related-list toolbar bridge, so the invite button sits left of the attach one.

**The `email` param names `objectOverride: 'sys_invitation'`, and must.**
`sys_member` has no `email` field, so a verbatim copy of the `sys_invitation`
declaration would leave the param unresolvable — the renderer answers that with
a `type: 'text'` fallback labelled by the raw field name, which still submits
and still looks fine (the ADR-0078 valid-but-inert class). `role` needs no
override: `sys_member` declares it, from the same
`BUILTIN_MEMBERSHIP_ROLE_OPTIONS` constant `sys_invitation` reads. A test now
holds this over **all three** mirrors, so the next copy of any action cannot
reintroduce the shape.

`add_member` keeps its behaviour and its label and is differentiated only in
chrome — `variant: 'secondary'` and `icon: 'link-2'` (the "attach an existing
record" icon `sys_account`'s `link_social` already uses) — so the two buttons
no longer render as identical primary `user-plus` twins. Both halves are
honoured by the renderer: it draws `primary` filled and every other variant
outlined.

The `@objectstack/spec` half is one line of registry bookkeeping:
`PUBLIC_AUTH_FEATURES.organization.gatedInputs` books the new gated action, as
it already books the other twelve. No schema, export or authorable key changes.
