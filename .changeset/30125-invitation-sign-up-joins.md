---
'@object-ui/app-shell': minor
'@object-ui/console': patch
---

feat(console,app-shell): registering from an invitation link joins that invitation's organization and enters the app in one step

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/console`: `/register`** opened from an invitation link (`?redirect=/accept-invitation/ID`) now accepts THAT invitation as the account the sign-up just created, switches the session to its organization and enters the console root. A new member used to pass three screens: the sign-up, the accept page ("Accept invitation"), and "Invitation accepted … Continue". The server still decides: an address that is not the invited one is refused, nothing is accepted, and the page goes on to the accept page as before, which shows the refusal. A person who opens the page already signed in accepts nothing there, and a sign-up that waits for email verification is accepted from the accept page the verification mail returns to.
- **`@object-ui/app-shell`: `DefaultRegisterPage`** does the same; it used to go to `/` after the sign-up and leave the invitation behind. New export **`useInvitationSignUpJoin(redirect)`**, the one hook both register pages call, answering `none`, `joining`, `joined` or `refused` (type `InvitationSignUpJoin`).
