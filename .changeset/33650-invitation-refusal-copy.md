---
'@object-ui/console': patch
'@object-ui/auth': patch
'@object-ui/i18n': patch
---

Clause-②: no
Metadata-protocol: none

Organization invitation refusals now read in the console's language. Opening an
invitation link that is unknown, already used, expired or revoked shows the
console's own sentence instead of better-auth's "Invitation not found!" (the
lookup's not-found answer carries no code, so it is read by its route, its 400
status and the missing code, never by its English text), and that sentence now
says the invitation may already have been used and where an accepted
invitation's organization is. Inviting someone who is already a member shows a
translated sentence instead of "User is already a member of this organization".
Errors thrown by `@object-ui/auth` now also carry the HTTP `status`.
