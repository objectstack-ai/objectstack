---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console-auth): an invitation link the server no longer knows reads "This invitation link is no longer valid" instead of offering a sign-up it will refuse, and a refused invitee is told which address the invitation was sent to

Clause-②: no (`getInvitationPreview`'s exported signature is unchanged; it now resolves `null` only for the preview door's own not-found body, which is what its documented contract already said)

Metadata-protocol: none

The signed-out invitation preview answers one 404 for an unknown, expired, accepted, rejected or cancelled invitation. The login and register pages read that 404 as "no preview", kept the "Accept your invitation … Create an account and join" flow, and the sign-up then failed with "Self-registration is not open on this system. Ask an administrator for an invitation." — telling a person holding an invitation link to go and get one.

- **A dead link.** All four pages (the console's `/login` and `/register`, and app-shell's `DefaultLoginPage` and `DefaultRegisterPage`) now show "This invitation link is no longer valid" with a link to the plain sign-in, and no sign-up prompt or form. The copy does not say which of the five cases it is, because the server does not say.
- **A refused invitation sign-up.** A `SELF_REGISTRATION_CLOSED` refusal on a register page opened from an invitation link reads the preview again. If the invitation is gone, the page shows the same notice. If it is still pending, the refusal reads "This invitation was sent to i***@example.com. Register with that address to accept it.", using the masked address the preview already returns.
- **`@object-ui/auth`.** `getInvitationPreview` resolves `null` only for a 404 that carries the door's `RESOURCE_NOT_FOUND` body. A 404 without it (a server that does not have the route) now rejects like any other failed read, so a page keeps its generic invitation copy instead of calling a valid link dead.
- **`@object-ui/app-shell`.** New `useInvitationArrival` (`preview`, `gone`, `recheck`) and `InvitationGoneNotice`; `useInvitationPreview` is unchanged. `signUpRefusalMessages` takes an optional invitation argument.
- **`@object-ui/i18n`.** Five new keys in all ten packs: `auth.login.invitationGoneTitle`, `auth.login.invitationGoneDescription`, `auth.login.invitationGoneSignIn`, `auth.register.errors.invitationSentTo`, `auth.register.errors.invitationAddressOnly`.
