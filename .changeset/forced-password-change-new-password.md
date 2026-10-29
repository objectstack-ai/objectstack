---
'@objectstack/plugin-auth': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-auth): a forced password change now requires a password different from the current one

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a credential door's accept set: `/change-password` and `/reset-password` stop accepting the current password as the new one while an administrator's forced change is outstanding, and the remedy is to choose a different password, never a rewrite of anyone's code or metadata. No exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only); every bumped package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered). -->

**BREAKING** (an accept-set narrowing), shipped as `patch`: the metadata protocol does not move, so the level is `patch` and this banner is the carrier.

When an administrator issues a password and asks for it to be changed at next sign-in (`sys_user.must_change_password`, set by Create User, Set Password and Import Users), the change now has to move the user to a new password.

**FROM.** With the forced-change flag set and the default `passwordHistoryCount` (0), a `/change-password` or `/reset-password` whose new password equals the current one completed and cleared the flag, so the user kept the password the administrator issued. With `passwordHistoryCount` above 0, a `/change-password` carrying a wrong current password and a recycled new one answered `400 PASSWORD_REUSE`.

**TO.** While the forced change is outstanding, `/change-password` and `/reset-password` refuse the current password as the new one with `400 PASSWORD_REUSE` ("Choose a new password that is different from your temporary password."), whatever `passwordHistoryCount` is, and the flag stays set until a different password is chosen. On `/change-password` a reuse refusal of either kind (the forced change's and the `passwordHistoryCount` ring's) is given only after the current password is confirmed: a request whose current password is wrong answers the endpoint's own `INVALID_PASSWORD` whatever the new password is, including a recycled one at a history depth above 0, which answered `PASSWORD_REUSE` before. A confirmed request reusing the current or a recent password still answers `PASSWORD_REUSE`. `/reset-password` carries no current password; its token is the authority, and the forced refusal applies to it directly.

**For clients.** A client that completes a forced change by sending the issued password back as the new one (an onboarding script, a test harness) must now send a different password.

Nothing else changes: with no forced change outstanding, which passwords count as reuse is still decided by `passwordHistoryCount` exactly as before. If the flag cannot be read, the request goes on as though no forced change were outstanding and the failure is logged through the auth manager's durability-degradation channel.

The Console's forced-change screen says the same thing in the user's language (all ten locale packs) when the new password matches the one typed as current, and sends no request.
