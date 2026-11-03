---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a completed password reset ends the account's other sessions, and a reset request answers the same way for any address without waiting on its mail

Clause-②: no (narrowing) — the auth manager refuses an `emailAndPassword.revokeSessionsOnPasswordReset: false` it accepted before, at construction and on every configuration patch. Nothing is widened: no export, route, key or answer is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, settings key or stored shape is added, removed, renamed or re-shaped, and no exported declaration changes. `emailAndPassword.revokeSessionsOnPasswordReset` stays declared by `@objectstack/spec`; what changes is which value plugin-auth's own entry validation accepts for the deployment configuration a host hands the plugin in code, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a deployment that sets `emailAndPassword.revokeSessionsOnPasswordReset: false` only.

- **A completed password reset ends the account's other sessions.** Every self-service reset door — the emailed link (`POST /api/v1/auth/reset-password`) and the phone OTP reset (`POST /api/v1/auth/phone-number/reset-password`) — ends every existing session of the account when it sets the new password, the same as an administrator's forced reset does. The person who reset the password signs in again with it. It is not a setting.
- **`revokeSessionsOnPasswordReset: false` is refused.** The auth manager refuses it at construction, which stops the boot, and on a configuration patch, where the standing configuration keeps ruling, with a message naming the key. `true` and an absent key are accepted and change nothing.
- **A reset request answers the same way for any address, without waiting on its mail.** `POST /api/v1/auth/request-password-reset` answers at once; the reset mail is built and sent after the response. A send that fails is logged on the server, at error, and never changes the answer.
- **Unchanged.** The answer's status and body; the reset mail's template, locale and recipient; the identity import, whose invitation mail is still awaited and still reported per row when it is not delivered; an administrator's forced reset and its revocation switch.
- **Who sees it.** A user signed in somewhere else when their password is reset is signed out there. A host whose configuration sets `revokeSessionsOnPasswordReset: false` no longer boots until the key is removed.

**The remedy.** Delete `revokeSessionsOnPasswordReset: false` from the `emailAndPassword` block the host passes the auth plugin; nothing else is needed.
