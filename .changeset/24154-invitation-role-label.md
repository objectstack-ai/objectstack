---
'@objectstack/plugin-auth': minor
'@objectstack/plugin-email': patch
---

fix(plugin-auth,plugin-email): the organization invitation mail names the invitee's role by its label in the mail's language (`成员`, `メンバー`, `Miembro`, `Member`), not by the stored value `member`

Clause-②: yes (widening)

- **What changed.** The zh-CN, ja-JP and es-ES invitation mails printed the stored membership role inside a translated sentence: 「邀请您以 member 的身份加入」. The sender now passes `{{role}}` as the `sys_member.role` option label in the locale the mail is written in, the same label the console shows for that option. It reads the label through the runtime's i18n service and the console's own object translation path, so a tenant's translation of the option, made in Studio, reaches the mail too. The four bodies keep interpolating the one `role` variable; its name and type are unchanged, and its declaration now says it carries the label.
- **The plain-text part names the role too.** The four text bodies gain the role clause their HTML bodies carry, so both parts of the mail name the same facts. For example, the English text is now `Dana (dana@example.com) invited you to join Northwind on Acme as Member.`
- **Stated fallbacks.** A role list (`admin,member`) is labelled role by role and joined as a list in the mail's language (`管理员和成员`). A value with no option label is named as stored, and one warning names it. With no i18n service, or one that fails, the mail names the option's authored English label, never an empty string.
- **New option (widening).** `AuthManagerOptions.getI18n?: () => II18nService | undefined` is a lazy accessor for the `i18n` service, read when the invitation is sent. `AuthPlugin` wires it from the kernel. An embedder that builds `AuthManager` itself and omits it gets the authored labels.
- **What changes for you.** If you have overridden `auth.invitation` and interpolate `{{role}}`, it now receives the label, not the stored value.
