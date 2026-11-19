---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a credential change ends access issued before it

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, metadata type or export is added, removed, renamed or re-shaped, and nothing stored is rewritten: what moves is the answer the auth doors give to an email-change link, a second-factor challenge or a password sign-in that predates the account's last password change, which is now the answer a link, challenge or password that was never valid gets. There is nothing for a migration to rewrite and no tombstone. -->

Once an account's password changes, the following, issued for that account before the change, no longer grant access after it:

- An email-change link (any link `POST /api/v1/auth/change-email` mints for the account, whichever address it is mailed to) minted before the change answers at `GET /api/v1/auth/verify-email` exactly what a link that was never issued answers: `401 INVALID_TOKEN`, or the `error=INVALID_TOKEN` redirect to its callback. Its owner requests a new one. A link's issue time is whole seconds, so one minted in the same second as the change is refused too.
- A second-factor challenge opened by a password sign-in before the change answers what a challenge that was never opened answers. The person signs in again with the new password.
- A door that ends the account's sessions when it sets the password ends every session opened before its password write: both reset doors, `POST /api/v1/auth/change-password` with `revokeOtherSessions: true` (the session it installs is kept), and the one-step invitation acceptance (ahead of the session it opens).
- A password sign-in during which the account's password changes is refused with what a wrong password answers at that door, and leaves no session.

The moment of the change is the last time the account's local password was written over, so every door that replaces a password counts, an administrator's `POST /api/v1/auth/admin/set-user-password` included. An account's first password is not a change. A check that cannot read the record refuses. Access issued after the change, and an account that never changed its local password, are untouched. No request, response or metadata shape changes.

**BREAKING** for a client that opens an email-change link, completes a second-factor challenge, or finishes a password sign-in after the account's password changed underneath it: each is now refused as above, with the code a never-issued link, a never-opened challenge or a wrong password already answers, so a client that handles those answers needs no change. The fix for a person: request a new email-change link, or sign in again with the new password.
