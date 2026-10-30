---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Setup's user screens show a user's real state, and the copy-password line only when a password was generated

Clause-②: no
Metadata-protocol: none

Four rows of the Setup → Users pass, all on the platform's own `sys_user` metadata:

- **Create User / Set Password result.** The dialog no longer carries the sentence "If a temporary password was generated, copy it now — it is shown only once and never stored." on every result. A dialog-level description shows on both outcomes, and a typed password returns no temporary password, so the line asked the administrator to copy something that was not there. The instruction is now the label of the Temporary password field itself ("Temporary password: copy it now, it is shown only once and never stored"), which the dialog draws only when the server generated one. The zh-CN, ja-JP and es-ES packs carry the same change.
- **User record, Details tab.** Details now shows the saved Locale (in Identity) and an Account Status section with Banned, Ban Reason and Ban Expires. These fields were hidden or in no section, and the details grid draws only its authored sections, so a banned user read as active.
- **Users list.** The default `all_users` view gains Banned and Platform Role columns, so a banned user or an admin is spotted without opening each record.
- **Locale help.** The help now says the setting is the language the user sees the interface in as well as their notifications. It used to say notifications only, while the console applies it to the whole interface. All four shipped packs carry it.
