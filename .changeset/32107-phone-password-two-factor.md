---
'@object-ui/auth': patch
---

fix(auth): signing in with a phone number and password on an account with two-factor sign-in on asks for the code, as the email path does, instead of saying "Invalid phone number or password."

Clause-②: yes (widening)
Metadata-protocol: none

- **`AuthClient.signInWithPhonePassword`** now answers `SignInResult`, the same type `signIn` answers: a session, or `{ twoFactor: { methods } }` when the server accepted the password and holds a pending two-factor sign-in. Finish it with `verifySignInTwoFactor`. Code that reads `result.user` / `result.session` straight off the answer must check `result.twoFactor` first (the two members are optional on the union, as on `signIn`).
- **`AuthContextValue.signInWithPhonePassword`** resolves `{ twoFactorRequired: boolean }` instead of `void`; on `true`, `twoFactorChallenge` is set and `LoginForm` draws the code step.
- A custom `AuthClient` implementation (a test double, an alternative backend) keeps type-checking as long as it returns a session; it may now also return the challenge.
- `signInWithPhoneOtp` is unchanged: better-auth's two-factor hook does not run on `/phone-number/verify`, so that answer never carries the challenge.
