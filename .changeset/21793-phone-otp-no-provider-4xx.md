---
'@objectstack/spec': minor
'@objectstack/plugin-auth': patch
---

Phone-number OTP with no deliverable SMS service now answers `400 SMS_SERVICE_REQUIRED` instead of a `500` with an empty body (#21793).

Clause-②: yes (widening)

- **`@objectstack/plugin-auth`.** `POST /api/v1/auth/phone-number/send-otp` on a deployment that turned phone sign-in on but has no SMS service that can deliver a code (none wired, or only the log transport in production) used to answer `500` with a `null` body: the send callback threw a plain `Error`, and better-auth's router turns anything but its own `APIError` into a bare 500. The login page had nothing to branch on and showed a generic failure. It now answers `400` with the body `{ "code": "SMS_SERVICE_REQUIRED", "message": "…" }`, a typed `APIError`, as the daily-quota branch of the same send already was. The message names the missing SMS delivery service and where an administrator configures it, and never carries the one-time code. `request-password-reset` is unchanged: it still answers `{ "status": true }` and sends nothing, so it reveals nothing about which numbers are registered.
- **`@objectstack/spec`.** `SMS_SERVICE_REQUIRED` is registered for `@objectstack/plugin-auth` in the ADR-0112 error-code ledger, beside its email sibling `EMAIL_SERVICE_REQUIRED`. `ErrorCode` (and so `ApiErrorSchema.code`) accepts one more value. Nothing that parsed before is refused now.

**Action for clients.** A client that branched on the old `500` for this case should branch on `code === 'SMS_SERVICE_REQUIRED'` instead. The public config already advertises the capability as `features.phoneNumberOtp`, which stays `false` on such a deployment.
