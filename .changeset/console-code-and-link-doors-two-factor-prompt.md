---
'@object-ui/auth': patch
'@object-ui/console': patch
---

fix(auth): the Console's phone-code sign-in and verify-email page continue to the two-factor prompt when the account has an enrolled second factor

Clause-②: yes (widening)
Metadata-protocol: none

- **`AuthClient.signInWithPhoneOtp`** now answers `SignInResult`, the same type `signIn` and `signInWithPhonePassword` answer: a session, or `{ twoFactor: { methods } }` when the server accepted the code for an account with an enrolled second factor. Finish it with `verifySignInTwoFactor`. It used to reject with "No account is registered for this phone number." for that answer. Code that reads `result.user` / `result.session` straight off the answer must check `result.twoFactor` first.
- **`AuthContextValue.signInWithPhoneOtp`** resolves `{ twoFactorRequired: boolean }` instead of `void`; on `true`, `twoFactorChallenge` is set and `LoginForm` draws the same code step the password sign-in paths reach. A hand-built `AuthContextValue` (a test double passed to `AuthCtx.Provider`) whose `signInWithPhoneOtp` resolves nothing must now resolve `{ twoFactorRequired: false }`.
- **Console `/verify-email`**: when verifying the address would also sign in an account with an enrolled second factor, the page says the email is verified (it used to say verification failed) and sends the person to sign in, where the two-factor step follows.
- A custom `AuthClient` implementation (a test double, an alternative backend) keeps type-checking as long as it returns a session; it may now also return the challenge.
