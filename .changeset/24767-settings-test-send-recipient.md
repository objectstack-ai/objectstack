---
'@objectstack/plugin-email': patch
'@objectstack/service-sms': patch
---

fix(plugin-email, service-sms): Setup's "Send test email" and "Send test SMS" send to the signed-in admin when the request names no recipient (#24767)

Clause-②: no

The Mail and SMS settings pages offer a Send test button and no recipient input, so the console's request carries no `to`. "Send test email" fell back to the From address — often a no-reply mailbox nobody reads — and with From empty it refused, asking for a "to" address the page has no field for. "Send test SMS" refused every press the same way.

With no `to` in the request, the test now goes to the person who pressed the button: `mail/test` sends to the caller's own account email and `sms/test` to the caller's own phone number, each read from the caller's own `sys_user` row. A `to` in the request body still wins, as before. When the caller's account has no address or number, or the account cannot be read, the action refuses and says that nothing was sent. A phone number is on an account only where phone sign-in is enabled, so on other deployments "Send test SMS" still needs a `to` in the request body.

`sms/test` no longer reports a send through the log-only transport (the namespace's default `None (log only)` provider) as a success. It answers `ok: false` with severity `warning`, as `mail/test` already does for its log transport. When the form names no delivering provider and the transport the deployment configured at boot carries the test, the success message names that transport instead of saying the message went "via log".

**Unchanged.**

- The request and result shapes of `POST /api/settings/mail/test` and `POST /api/settings/sms/test`: no key, route or setting is added.
- Which provider and credentials a test uses: the saved values overlaid with the form's unsaved edits, as before.
- Saving the Mail form still judges a required field only when the save writes it, or writes a key its visibility depends on.
