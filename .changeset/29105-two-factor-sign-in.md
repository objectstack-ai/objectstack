---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(auth): a user with two-factor sign-in on is asked for their code after the password, instead of staying on the sign-in page

Clause-②: yes (widening)
Metadata-protocol: none

A user who turned on two-factor sign-in (an authenticator app) and signed in with their password could not get into the Console: the server accepted the password and asked for the second factor, the Console dropped that answer, and the sign-in page stayed as it was, with no code field and no message.

The sign-in form now shows a second step: the 6-digit code from the authenticator app, or one of the backup codes saved at set-up. A wrong code says so in place and the user can try again; "Back to sign in" returns to the password step. When the server ends the attempt (too many wrong codes, or ten minutes passed), the password step comes back with the reason. Both login pages (the Console's and `DefaultLoginPage`) show the step, in every language pack.

Added to `@object-ui/auth`: `AuthClient.signIn` answers `{ twoFactor: { methods } }` for such an account (exported `SignInResult`, `TwoFactorChallenge`, `TwoFactorMethod`); `AuthClient.verifySignInTwoFactor(code, 'totp' | 'backup-code')` finishes it (`SignInTwoFactorCodeKind`); `useAuth()` gains `twoFactorChallenge`, `verifySignInTwoFactor` and `cancelTwoFactorChallenge`, and its `signIn` resolves `{ twoFactorRequired }`; `LoginFormLabels` gains ten `twoFactor*` labels. `@object-ui/i18n` gains the matching `auth.login.twoFactor*` and `auth.login.errors.twoFactor*` keys.

What to do: nothing, unless you pass your own `AuthClient` to `AuthProvider`. `verifySignInTwoFactor` is a required member of `AuthClient`, so such an implementation must add it to type-check (and its `signIn` may now answer `{ twoFactor }`).
