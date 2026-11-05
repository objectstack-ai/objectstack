---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a person who verifies their email during the mobile sign-in hand-off gets a mail link that works, and the hand-off's refusal time survives the verification pages (#30157)

Clause-②: no
Metadata-protocol: none

On a server that requires email verification, a person signing up from the mobile app's sign-in (the hand-off `redirect` on `/register`) got a verification mail whose link landed on a Console page that does not exist (`/_console/api/v1/auth/one-time-token/handoff?…`). The mail is usually opened in a browser that is not the app's sign-in window, and often on another device, so the link now returns to `/verify-email?handoff=verified`: the page says the address is confirmed and to go back to the app and sign in there. It offers no Console sign-in and hands out no sign-in token in that browser. The same holds for the "Resend verification email" mail. Every other `redirect` (an invitation, a Console page) keeps the link it had.

The hand-off's refusal time (`handoff_refused_at`) is now carried through `/verify-email-prompt` on all three hops: `/login`'s "email not verified" branch, `/register`'s "verification required" branch, and "Back to login". Beside any other `redirect`, those links are unchanged.

New string: `auth.verifyEmail.handoffSuccessDescription` (all ten locales).
