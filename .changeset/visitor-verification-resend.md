---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a verification-email resend from a visitor who is not signed in answers the same whatever the send does

Clause-②: no
Metadata-protocol: none

- **The rule.** `POST /api/v1/auth/send-verification-email` from a visitor who is not signed in answers the same whatever the send does. While the email transport is live it answers `{ "status": true }`: the verification mail is built and sent after the response, as the sign-up's verification mail is, and a send that fails is logged on the server at error (`verification email was not delivered`).
- **While the email transport is not live** (no email service, or one whose `isConfigured()` does not answer `true`, such as the `log` transport), every such resend is refused with `400 EMAIL_SERVICE_REQUIRED`, the code `/change-email` and the identity import already answer for a deployment with no email delivery. Its message names the fix (Settings → Mail), and the verify screens show it.
- **Unchanged.** A signed-in caller's resend for their own address, by session cookie or by bearer token, still awaits its send, still reports one that failed, and is not refused while the transport is not live. A server-side `auth.api.sendVerificationEmail` call, which carries no request, still awaits its send.
