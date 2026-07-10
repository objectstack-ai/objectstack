---
"@objectstack/plugin-sms": minor
"@objectstack/plugin-auth": minor
"@objectstack/service-messaging": minor
"@objectstack/service-settings": minor
"@objectstack/spec": minor
"@objectstack/cli": minor
---

feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

#2766 shipped phone+password sign-in but no OTP — the platform had no SMS
delivery capability. This adds the missing infrastructure end to end:

- **New `@objectstack/plugin-sms`** — `ISmsService`/`ISmsTransport` contracts
  (spec) with Aliyun SMS (ACS3-HMAC-SHA256, template-based) and Twilio
  transports plus a dev log fallback. Configured through the new `sms`
  settings namespace (live provider rebind, encrypted secrets, send-test
  action; `OS_SMS_*` env keys win at the resolver). Deliberately NO message
  persistence and NO body logging — SMS bodies carry OTP codes.
- **Messaging `sms` channel** — registered at kernel:ready when an `sms`
  service is present; `notify(channels:['sms'])` resolves
  `sys_user.phone_number`, renders `(topic,'sms',locale)` templates, and
  inherits outbox retry/dead-letter.
- **Phone OTP flows open** — the phoneNumber plugin's `sendOTP` /
  `sendPasswordResetOTP` now deliver via SMS, enabling
  `/phone-number/send-otp` + `/verify` (OTP sign-in/verification) and
  `/phone-number/request-password-reset` + `/reset-password` (self-service
  reset). Without a deliverable SMS service they keep failing loudly
  (NOT_SUPPORTED); `features.phoneNumberOtp` advertises real availability.
  Shipped with the abuse hardening: explicit `allowedAttempts: 3`, always-on
  per-number cooldown (60s) + rolling-hour cap (5, secondaryStorage-shared
  across nodes), `/phone-number/*` in the settings-bound per-IP rate-limit
  rules, and OTP codes never reach logs or error messages.
- **Import SMS invites** — `/admin/import-users`'s `invite` policy now
  supports phone-only rows: a credential-free invitation SMS points the
  employee at phone-OTP first sign-in followed by self-set password; mixed
  files validate the reachable channel per row.
