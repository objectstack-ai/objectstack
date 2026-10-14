---
'@objectstack/platform-objects': patch
---

The Setup "Create User" and "Set Password" dialogs no longer offer a "Generate Temporary Password" box the server ignores once a password is typed

Clause-②: no

The `sys_user` actions `create_user` and `set_user_password` showed two controls for one decision: a "Generate Temporary Password" box (ticked by default on Create User) and a password field labelled "leave empty to generate". With a password typed, the box did nothing, yet it was sent ticked, so its state was false whenever the field was filled.

The password field's label is now the only rule. `generatePassword` is no longer a dialog param on either action. It is sent as a constant `true` in each action's `bodyExtra`, and the endpoint's existing rule gives the label's behaviour:

- **A typed password** is the one applied, and nothing is generated.
- **An empty password** generates a temporary password, shown once in the result dialog. On Set Password this is new: the box was unticked by default there, so an empty field answered `400` unless the admin ticked it.

The endpoints `POST /api/v1/auth/admin/create-user` and `POST /api/v1/auth/admin/set-user-password` are unchanged. A caller that sends neither a password nor `generatePassword: true` still gets `400`.
