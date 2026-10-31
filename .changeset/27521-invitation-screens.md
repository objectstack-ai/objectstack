---
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-form': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

Clause-②: yes (widening: `@object-ui/app-shell` exports `InvitationLinkHint` and `@object-ui/plugin-form` exports `useInitialFieldFocus`; no accept set moves)
Metadata-protocol: none (platform object metadata only, no authorable key: `sys_invitation.status` options gain display labels, with `rejected` read as "Declined"; the role param of the four `invite_user` actions, `sys_member.add_member` and `sys_member.update_member_role` gains one shared `helpText`; `sys_invitation.resend_invitation` gains a `description` and carries its email and role over from the row; `sys_member.update_member_role` gains a `description` naming the member; the `expired` invitations list projects `role`)

The Invitations screens read more clearly and behave more predictably. Invitation statuses show as labels (Pending, Accepted, Declined, Expired, Canceled) instead of raw values. Every role picker that grants an organization role explains each role on its own line, and Change Role names the member it changes. Resend is a confirmation that names the invitee and keeps the invitation's email and role, instead of an editable form. The workspace's cancel dialog dismisses with "Keep invitation".

The console's action dialogs check an email or URL param before anything runs and mark a malformed value on its field. They open on their first editable field instead of Cancel, and closing one returns focus to the control that opened it: an action button that was disabled while its action ran, a row menu's trigger, or the first opener when a param dialog hands over to a result dialog. This applies to every action that uses the param, confirm and result dialogs.

The sign-in page tells a visitor to open their invitation link where sign-up is by invitation only. After accepting an invitation, the page says the user joined the organization and as which role, and Continue enters it.
