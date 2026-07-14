# @objectstack/service-sms

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- 1c19139: refactor(sms): rename `@objectstack/plugin-sms` to `@objectstack/service-sms`

  Infrastructure services follow the `service-*` convention
  (`service-messaging`, `service-settings`, …) — the `plugin-*` prefix was a
  misfit for a package whose whole job is registering the `sms` kernel
  service (`plugin-email` is legacy debt, not precedent). Same exports, same
  `SmsServicePlugin` class, same `sms` service id and settings namespace —
  only the package name and its home (`packages/services/service-sms`)
  change. The one published `@objectstack/plugin-sms@14.3.0` release should
  be npm-deprecated in favour of `@objectstack/service-sms`.

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Minor Changes

- c1064f1: feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

  #2766 shipped phone+password sign-in but no OTP — the platform had no SMS
  delivery capability. This adds the missing infrastructure end to end:

  - **New `@objectstack/service-sms`** — `ISmsService`/`ISmsTransport` contracts
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

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
