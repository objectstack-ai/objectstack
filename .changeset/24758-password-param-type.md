---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the password an administrator or user types into an action dialog is masked, no longer shown in clear text

Clause-②: no (an input's presentation: the param still accepts the same string, and no accept set or served shape moves)

Twelve credential params on the identity objects were declared `type: 'text'`, so the console's action dialog drew each as a plain text input and the typed password was readable on screen and in screenshots. Each now declares `type: 'password'`, which the dialog draws as a masked input:

- `sys_user`: `create_user`'s `password` and `set_user_password`'s `newPassword` (Setup › Users), `change_my_password`'s `currentPassword` and `newPassword`, and the `password` of `delete_my_account`, `enable_two_factor`, `disable_two_factor` and `generate_backup_codes`.
- `sys_two_factor`: the `password` of `enable_two_factor`, `disable_two_factor` and `regenerate_backup_codes`.
- `sys_sso_provider`: `register_sso_provider`'s `clientSecret`.

Labels, names, `required` and the posted body are unchanged: the value is still posted as the string typed, and no endpoint changes what it accepts.
