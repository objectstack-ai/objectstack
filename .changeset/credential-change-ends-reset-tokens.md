---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a change to a user's credential ends every other outstanding password-reset token of that user

Clause-②: no (narrowing) — every door that sets a user's password ends every other password-reset link and texted reset code still outstanding for that user, in the same request and before the new password is written: a completed reset (`POST /reset-password`, `POST /phone-number/reset-password`), the user's own `POST /change-password`, an administrator's `POST /admin/set-user-password`, and a first password (`POST /set-initial-password`). No request, response or metadata shape is added, removed or re-shaped; a link or code requested after the change resets as usual.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. What moves is which reset links and codes stay live after a password change, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** password-reset narrowing (`@objectstack/plugin-auth`): a change to a user's credential ends every other outstanding password-reset token of that user.

- **Now.** When a user's password is set, by any door, every reset link (`/request-password-reset`) and texted reset code (`/phone-number/request-password-reset`) issued for that user beforehand is ended. An ended link or code answers exactly what one never issued answers: `400 INVALID_TOKEN` at `POST /reset-password`, the `INVALID_TOKEN` redirect at the link's landing (`GET /reset-password/:token`), and the never-sent answer at `POST /phone-number/reset-password`. With a host `secondaryStorage`, its cached copy is removed too. A password write whose outstanding tokens cannot be ended does not land: the door answers an error and the old password stands.
- **Who moves.** A person holding a reset link or code issued before their password changed requests a new one. Nothing else changes: another user's links and codes, and a link or code requested after the change, reset as before.
