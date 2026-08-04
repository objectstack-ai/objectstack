---
"@objectstack/service-settings": minor
"@objectstack/plugin-email": minor
---

fix(service-settings,plugin-email): the mail provider dropdown lists only providers that actually deliver (#5094)

**Settings → Mail → Provider** offered `SMTP | SendGrid | Amazon SES | Postmark`.
`@objectstack/plugin-email` has never carried a SendGrid or an SES transport —
`makeTransport` knows `log` / `resend` / `postmark` / `smtp` and nothing else. So
selecting either of the two validated, saved, showed a success toast, and then
delivered no mail at all: the same declared-but-not-delivered gap #5087 closed
for SMTP, one field to the left.

The same field broke the invariant in the other direction at the same time:
**`resend` has shipped a working transport all along and was not on the list**,
so nobody could pick the one HTTP provider that worked.

**The dropdown is now `SMTP | Resend | Postmark | None (log only — no real
delivery)` — exactly the set `makeTransport` can build.** No email capability was
removed with SendGrid and SES. Both publish SMTP endpoints, and #5087 shipped a
real `SmtpTransport`, so both are configured today as `smtp`:

| provider | host | port | credentials |
|:---------|:-----|:-----|:------------|
| SendGrid | `smtp.sendgrid.net` | 587 | username `apikey`, password = your API key |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587 | SES **SMTP credentials** (generated in the SES console — not your AWS access keys) |

The provider field's own description says this, so the migration is in front of
whoever goes looking for the option that disappeared.

`log` is listed rather than hidden. It is the one option that does not deliver —
but it does not pretend to: the label says so, `LogTransport` still records every
message to `sys_email`, and "Send test email" answers `ok: false` for it. That
gives an operator the deliberate, visible opt-out AGENTS.md asks a degradation to
be, instead of expressing "no outbound mail" as a half-filled SMTP form. It is
also what makes *offered* and *deliverable* the same set rather than merely
overlapping — which is the property a test can hold.

**Already saved `sendgrid` or `ses`? Nothing breaks and nothing goes quiet.** The
stored value outlives the dropdown, so `applyMailSettings` now recognises it
explicitly: the previous transport is kept (a settings row written by an older
release must never fail a boot), and the server logs at `error` with both halves
AGENTS.md requires — the consequence (*no mail is delivered through it*) and the
fix (the SMTP settings above), not a bare "unknown provider". It is checked
*before* the API-key check, because "set an API key" is the wrong instruction for
a provider that has nothing to hand a key to. "Send test email" refuses the same
way and sends nothing. Switching the provider to `smtp` and saving recovers the
transport without a restart.

Two smaller corrections in the same field:

- `api_key` is now shown and required for exactly `resend` and `postmark`
  (`provider === 'resend' || provider === 'postmark'`). It was `provider !==
  'smtp'`, which only worked because every non-SMTP option happened to be an
  HTTP API; `required` is enforced server-side wherever the field is visible, so
  that expression would have refused to save "None (log only)" until an API key
  it never reads had been typed in.
- The built-in `mail/test` fallback (the one that runs when no email plugin is
  mounted) rejects any `provider` outside the manifest's own option list instead
  of answering "the form is well-formed".

**Held by a test, in both directions.** `EMAIL_TRANSPORT_PROVIDERS` is now a
runtime array (the `EmailTransportProvider` union is derived from it), and
`plugin-email`'s `mail-manifest-providers.contract.test.ts` asserts set equality
between it and the manifest's option values, then builds a real transport for
each. Adding an option without a transport fails; adding a transport without an
option fails. `RETIRED_EMAIL_PROVIDERS` / `isEmailTransportProvider` /
`unsupportedProviderFix` are exported alongside it for hosts that surface the
same guidance.
