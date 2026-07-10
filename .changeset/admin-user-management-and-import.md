---
"@objectstack/plugin-auth": minor
"@objectstack/platform-objects": minor
"@objectstack/rest": minor
"@objectstack/spec": minor
---

feat(auth): admin direct user management, phone sign-in, and identity bulk import (#2766, re-scoped #2758)

`sys_user` is managed by better-auth and its generic CRUD is suppressed, so
until now the only way to add a teammate was the email-dependent invite flow.
This ships three staged capabilities:

- **Admin direct user management** — `POST /api/v1/auth/admin/create-user`
  and a wrapped `POST /api/v1/auth/admin/set-user-password` (ADR-0068
  platform-admin gate; better-auth pipeline so credentials are real). Optional
  generated temporary password (returned once, never persisted or logged) and
  a new `sys_user.must_change_password` flag enforced through the ADR-0069
  authGate (`403 PASSWORD_EXPIRED` until the user changes it). New
  `create_user` action and upgraded `set_user_password` action on the Users
  list — pure schema, no frontend changes.
- **Phone sign-in (opt-in `auth.plugins.phoneNumber`)** — better-auth
  phoneNumber plugin, phone+password only (`POST /sign-in/phone-number`);
  OTP flows stay off until SMS infrastructure exists. Adds
  `sys_user.phone_number` (unique) / `phone_number_verified`. Phone-only
  accounts get an undeliverable placeholder email
  (`u-<random>@placeholder.invalid`, never derived from the phone number);
  all auth mail callbacks refuse placeholder recipients.
- **Identity bulk import** — `POST /api/v1/auth/admin/import-users` accepts
  the same payloads as the generic import routes (rows/csv/xlsx, dryRun,
  upsert by email or phone) but writes every row through better-auth.
  Password policies: `invite` (reset-link email per created user; requires an
  EmailService) and `temporary` (per-row one-time passwords + forced change).
  Sync only, ≤500 rows per request; no undo; upsert updates touch profile
  fields only and can never reset an existing user's password.
  `prepareImportRequest` and the CSV/xlsx parsers moved from rest-server.ts
  to an exported `import-prepare.ts` module (behavior unchanged).
