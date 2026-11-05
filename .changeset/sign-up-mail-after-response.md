---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a sign-up answers without waiting for any mail send, whether or not the address already has an account

Clause-②: no
Metadata-protocol: none

- **The rule.** `POST /api/v1/auth/sign-up/email` answers without waiting for any mail send, whether or not the address already has an account: the verification mail, and the notice to an address that already has an account, are built and sent after the response, as the password-reset mail already is.
- **A send that fails is logged on the server**, at error (`verification email was not delivered`; the notice keeps its own error line), and never reaches the caller, whose answer is the one a sent mail gets, as before.
- **Unchanged.** The answer's status and body; the sign-up rate limits; the mails themselves; a signed-in caller's `/send-verification-email` resend, which still awaits its send and still reports one that failed; and a server-side `auth.api.signUpEmail` call, which carries no request and still awaits its sends.
