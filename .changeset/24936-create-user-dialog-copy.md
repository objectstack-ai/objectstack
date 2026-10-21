---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the Create User result dialog no longer tells an admin who typed the password to copy a temporary one

Clause-②: no (text only: the create-user result dialog's sentence and button; no param, response, status, outcome or export moves)

`sys_user.create_user`'s result dialog said "Copy the temporary password now — it is shown only once and never stored." with an "I have saved this password" button, in both outcomes. The endpoint returns `temporaryPassword` only when it generated one, so after a typed password the dialog showed the email alone and asked the admin to save a password it never showed. The dialog now reads "If a temporary password was generated, copy it now — it is shown only once and never stored." with a "Done" button — the same sentence and button as `set_user_password`, true for a typed and for a generated password. The zh-CN, ja-JP and es-ES bundles carry the same change, reusing `set_user_password`'s existing translations.
