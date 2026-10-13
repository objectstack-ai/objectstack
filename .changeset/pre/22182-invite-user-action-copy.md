---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Invite User explains itself in its dialog and names the invitee in its success message

Clause-②: no

- **The parameter dialog.** `invite_user` on `sys_user`, `sys_invitation` and `sys_member` declares a `description`: "Invite someone by email address. They join this organization with the chosen role when they accept the invitation." The console shows it as the dialog's subtitle, where a generic "Please provide the required information to continue." showed before.
- **The success toast.** `successMessage` is now `Invitation sent to ${result.email}`. `POST /api/v1/auth/organization/invite-member` answers the invitation row, and its top-level `email` is the invitee's address as stored (lowercased), so the toast reads "Invitation sent to ada@example.com" where it read "Invitation sent".
- **Translations.** The zh-CN, ja-JP and es-ES bundles carry the new description and a success message that keeps the `${result.email}` token, so every locale names the invitee.
