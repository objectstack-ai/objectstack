---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the phone-number password-reset request answers without waiting for the SMS send, as the emailed reset does

Clause-②: no
Metadata-protocol: none

- **The rule.** `POST /api/v1/auth/phone-number/request-password-reset` answers at once, the same way for any number: the reset text is built and sent after the response, as the emailed reset (`POST /api/v1/auth/request-password-reset`) already sends its mail.
- **A send that fails is logged on the server**, at error (`phone password-reset text was not delivered`), and never reaches the caller, who is answered `{ status: true }` either way, as before. The one-time code is in the text only, never in that line.
- **Unchanged.** The answer's status and body; the per-number cooldown and hourly cap and the per-IP limit on the route; the text itself; and a server-side `auth.api.requestPasswordResetPhoneNumber` call, which carries no request and still awaits its send.
