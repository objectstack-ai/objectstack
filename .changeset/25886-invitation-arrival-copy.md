---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(app-shell,console): an invitee who opens the invitation link signed out is greeted for the invitation, offered "Create an account and join" first, and the accept page names the inviter

Clause-②: yes
Metadata-protocol: none

- **Login page.** A signed-out visitor arriving at `/login?redirect=/accept-invitation/ID` used to see the returning-user card ("Welcome back · Sign in to continue your work") with a small "Sign up" link under the form. Both login pages (the console's own and `DefaultLoginPage`) now title the card "Accept your invitation · Use the email address the invitation was sent to." Where the server offers sign-up to this visitor, a full-width "Create an account and join" link (the new `InvitationSignUpPrompt` export) sits above the sign-in form in place of the small link. With sign-up switched off, the visitor gets the invitation header and the sign-in form only.
- **Register page.** From an invitation redirect, both register pages title the form "Create an account to join" and ask for the address the invitation was sent to, because only that account can accept it.
- **Accept page.** `DefaultAcceptInvitationPage` shows an "Invited by" row with the inviting member's email, which `GET /organization/get-invitation` already returns as `inviterEmail`. That route returns no inviter name.
- **Not in this change.** The signed-out pages name no organization, inviter or invited address, and do not prefill the email. The only invitation read the server serves answers a signed-out caller `401`, so a preview for signed-out visitors needs a new server read first.
- New locale keys in all ten packs: `auth.login.invitationTitle`, `auth.login.invitationDescription`, `auth.login.invitationSignUpButton`, `auth.login.invitationSignInDivider`, `auth.register.invitationTitle`, `auth.register.invitationDescription`, `organization.accept.invitedBy`.
