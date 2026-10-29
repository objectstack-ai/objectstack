---
'@objectstack/plugin-auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-auth): a forced password change now requires a password different from the current one

Clause-②: no
Metadata-protocol: none

When an administrator issues a password and asks for it to be changed at next sign-in (`sys_user.must_change_password`, set by Create User, Set Password and Import Users), the change now has to move the user to a new password. While that forced change is outstanding, `/change-password` and `/reset-password` refuse the current password as the new one with `400 PASSWORD_REUSE` ("Choose a new password that is different from your temporary password."), whatever `passwordHistoryCount` is, the default 0 included, and the flag stays set until a different password is chosen. On `/change-password` a reuse refusal is given only after the current password is confirmed. This now also holds for the `passwordHistoryCount` check: a request whose current password is wrong gets the endpoint's own `INVALID_PASSWORD` whatever the new password is, and a confirmed request reusing the current or a recent password still gets `PASSWORD_REUSE`. `/reset-password` is unchanged; its token is the authority.

Nothing else changes: with no forced change outstanding, which passwords count as reuse is still decided by `passwordHistoryCount` exactly as before.

The Console's forced-change screen says the same thing in the user's language (all ten locale packs) when the new password matches the one typed as current, and sends no request.
