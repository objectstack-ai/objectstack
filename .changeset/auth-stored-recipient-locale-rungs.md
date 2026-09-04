---
"@objectstack/plugin-auth": patch
---

fix(auth): auth OTP texts and auth mail now read the recipient's own `sys_user.locale`

`sys_user.locale` has been a first-class column since #13881, and user-writable
since the 2026-09-03 ruling, but plugin-auth's own sends never read it: a phone
OTP was rendered in the deployment's language and auth mail in whichever
language the triggering *request* asked for. So a Chinese-speaking user on an
English deployment got an English verification code, and a password reset an
admin initiated for them carried the **admin's** browser language.

Both ladders now start one rung higher, in the order ruled for #14788
(option D, 2026-09-03): the recipient's own stored `sys_user.locale` → the
request's `Accept-Language` → the deployment default. The recorded reasoning is
that a value the user chose is stronger evidence of intent than the
`Accept-Language` the browser just sent — and the send that forces the order is
the one where the requester is not the recipient.

- **Phone OTP SMS** (`/phone-number/send-otp` and
  `/phone-number/request-password-reset`) resolves the recipient by the unique
  `phone_number` and renders in their language. There is no request rung on this
  surface — better-auth hands these callbacks a phone number and a code and
  nothing else — so the chain is stored → deployment here.
- **Auth mail** — password reset, email verification and the change-email
  notice — reads the column off the recipient row it already identifies.

Everything underneath is unchanged. An account with no stored locale still gets
the deployment default, and with nothing configured at all the documented
`en-US` floor (and the built-in `en` SMS row) still applies. The read is
best-effort and never blocks a send: a missing column, an unavailable datasource
or a value that cannot name a language all resolve to "no stored preference",
never to a failed delivery. The value at rest is normalized by
`@objectstack/service-messaging`'s `normalizeRecipientLocale` — the platform's
one reader of that column, reused rather than copied, so its refusal of the
stringified-nothing literals holds here too.

Invitations are deliberately not included: an invitee has no `sys_user` row
until they accept, so both the mail and SMS invite paths keep the deployment
rung.
