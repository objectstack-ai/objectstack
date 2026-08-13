---
"@objectstack/plugin-auth": minor
"@objectstack/plugin-email": minor
---

feat(auth): change-email now notifies the PREVIOUS address — without gating on it (#8019)

Self-service email change verified only the **new** address, so an attacker
holding a live session (stolen cookie, unattended device, a session not yet
revoked) could move the account identity end to end while the original owner's
mailbox received **nothing** — and the account-recovery path moved with it.
Password knowledge was never required, because the session already
authenticated the request.

`POST /change-email` now sends an `auth.email_change_notice` mail to the address
the account is being moved away from, stating what was requested, the new
address, and who to contact. The notice ships in all four supported locales
(`en-US`, `zh-CN`, `ja-JP`, `es-ES`).

**The change itself is unchanged.** It still completes on the new address's
verification alone — no approval step, no second click, no new gate. That is
enforced structurally rather than promised: the notice is sent from the
after-hook, once better-auth has already produced its response, and every
failure it can hit (no transport, unseeded template, dead mailbox) is swallowed.
A notification that took the flow down with it would be the exact failure this
change exists to avoid.

better-auth's own `user.changeEmail.sendChangeEmailConfirmation` stays **off**.
Measured against the installed 1.7.0-rc.2, that option is not a notifier: the
endpoint returns immediately after invoking it and the new address is never
mailed until the old one clicks, so enabling it would add the approval gate this
change deliberately does not introduce.

⛔ The notice carries no undo/rollback link. Reverting a completed change is a
separate flow and a separate decision.
