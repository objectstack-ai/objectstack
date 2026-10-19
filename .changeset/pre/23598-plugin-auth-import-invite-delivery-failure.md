---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a user import reports an invitation that the email transport failed to deliver

Clause-②: no

Setup › Users › Import (`POST /api/v1/auth/admin/import-users`) used to report an email invitation as delivered when the email transport failed. The import invites by asking better-auth for a password reset, and better-auth catches whatever the send throws and still answers `{ status: true }`. So the import's `INVITE_EMAIL_FAILED` path was never reached by a failed delivery: the row read `delivery: 'email'`, and `summary.errors` stayed `0`.

- **A failed invitation is now reported on its row.** This covers a transport that answers `failed` and a transport that throws. The row is `ok: false`, has no `delivery`, carries `code: 'INVITE_EMAIL_FAILED'` and an `error` naming the transport's reason, and is counted in `summary.errors`. Its `action` stays `'created'` and its `id` stays, because the account exists. The fix is to send the invitation again or to set the user's password as an admin. The import does not roll the row back and does not fall back to a temporary password.
- **The SMS invitation reports a failure the same way.** A phone-only row whose invitation SMS fails is `ok: false` with no `delivery`, carries `code: 'INVITE_SMS_FAILED'`, and is counted in `summary.errors`. Before, it read `delivery: 'sms'` and was not counted.
- **A delivery is reported only when the email service accepts it.** A row is reported delivered when the service answers `sent` or `queued`. If the reset request answers without the service accepting the message, the row is reported failed, never delivered.
- **`summary.delivery` counts only deliveries that succeeded.** A row whose invitation failed is counted in `summary.errors` and in `summary.created`, so `created + updated + skipped + errors` exceeds `total` by exactly those rows.
- **A successful invitation is reported as before.** A public `POST /api/v1/auth/request-password-reset` is unchanged: it answers the same thing whether the address's mail went out, failed, or has no account behind it.
