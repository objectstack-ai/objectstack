---
"@objectstack/plugin-auth": minor
---

feat(plugin-auth): auth mail follows the caller's `Accept-Language`, deployment default second (#14319)

Request-triggered auth email — signup verification, password reset, magic link,
and the change-email notice — now picks its `sys_email_template` row from the
requesting caller's `Accept-Language`, falling back to the deployment default
(`localization.locale`, then `i18n.defaultLocale`) and finally to
`EmailService`'s documented `en-US`.

The motivating case is the one no deployment default can answer: at cloud
self-service signup there is no workspace yet, so nothing on the server
represents that person's language — a Chinese browser reached a Chinese signup
screen and received an English verification email.

The header is parsed by the platform's existing `preferredLocaleFromHeader`,
the same function REST uses for metadata translation and the runtime dispatcher
uses for `ExecutionContext.requestLocale`, so the mail cannot disagree with the
screen that triggered it. A requested locale takes effect only when it names one
of `AUTH_EMAIL_TEMPLATE_LOCALES` (`en-US`, `zh-CN`, `ja-JP`, `es-ES`); anything
else falls through rather than naming a row that does not exist.

Two deliberate exclusions. **Invitations keep the deployment default**:
better-auth hands that callback a request too, but it is the *inviter's*, and
stamping their browser language onto the invitee's mail would reproduce this
same defect one seat over. **Per-user language stays deferred** — `sys_user`
grows no locale column here.

This ships as `minor` because it changes which template row an existing
deployment sends: a workspace whose users' browsers ask for a different language
than the workspace declares will now send in the browser's language.

**Ruling:** maintainer, 2026-09-02, superseding the 2026-08-13 ruling that had
rejected `Accept-Language` outright. Both are recorded, with the older one
marked superseded, on `AuthManager.setDefaultEmailLocale`.
