---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-email': patch
---

fix(plugin-auth,plugin-email)!: the invitation mail says when its role label stayed English, and states when the invitation expires

**The role label.** The organization invitation mail names the invitee's role by its `sys_member.role` option label in the mail's locale (`成员`, `メンバー`, `Miembro`). When the i18n service answered without a translation for that locale, the mail named the English label (`Member`) inside a Chinese, Japanese or Spanish sentence, and logged nothing. Only a read that threw was reported. That happens when there is no i18n service, when the service holds no bundle for the locale, or when its reported locales (`i18n.supportedLocales`, when declared) do not name the locale as the bundles spell it. Now one `warn` is logged for the send: `[AuthManager] invitation mail: no 'zh-CN' label was found for the membership role(s) 'member'; …`. It names the locale, the roles and what to check. The mail is still sent as before. A mail in English, or a read that already warned because it threw, logs nothing extra.

**The expiry.** The `auth.invitation` mail never said when its link stops working (better-auth's window, 48 hours by default), so an invitation opened late failed at the accept page with no warning. The sender now passes `invitation.expiresAt` as a new template variable, `expiresAt`, as an ISO-8601 instant. Each of the four built-in bodies, HTML and text, ends with one sentence that renders it with the `datetime:long` formatter. The date reads in the mail's locale and the send's reference timezone, with the zone named: 「此邀请将于 2031年3月4日 UTC 05:06:07 过期。」 / "This invitation expires on March 4, 2031 at 5:06:07 AM UTC.". The template engine has no conditionals, so every body states the expiry, and the built-in rows declare `expiresAt` **required**. A send without it is refused (`MISSING_VARIABLES: expiresAt`) and is never sent with a dangling sentence. The built-in sender always has better-auth's expiry. If the value does not read as a date, the sender leaves it out and logs one `warn` naming the invitation id and saying the mail will be refused, so the invitation can be resent. A tenant or app override of `auth.invitation` keeps its own bodies and variables, and can use `{{ expiresAt | datetime:long }}`.

Clause-②: no (narrowing: the built-in `auth.invitation` rows declare a new required variable, `expiresAt`, so a `sendTemplate` of `auth.invitation` that names no `expiresAt` is now refused with `MISSING_VARIABLES` where it used to be sent)

Metadata-protocol: none (a built-in template row's declared variables, read by the email service at send time; no spec key, authorable spelling or stored shape moves)

**BREAKING** for code that sends `auth.invitation` itself (the built-in organization-invitation sender already passes the value).

- **Before.** `auth.invitation` declared no expiry, and a send naming `inviter`, `organization`, `role`, `acceptUrl` and `appName` was delivered.
- **Now.** The same send is refused with `MISSING_VARIABLES: expiresAt`.
- **Fix (one line).** Add the invitation's expiry instant to the send's `data` as `expiresAt`.

<!-- adr-0087: not-required (no-migration-prescription) a send-time refusal of an `auth.invitation` mail that names no `expiresAt`: no authorable key, spelling or stored shape moves, the email-template schema is unchanged, and no stored row is read, rewritten or converted. The repair is a value only the sender holds (the invitation's expiry), which no ledger entry can derive. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a template row's declaration, not a TS interface (not runtime-interface-only). -->
