---
'@objectstack/platform-objects': patch
---

fix(identity): two Setup outcome texts say only what is true

Clause-②: no
Metadata-protocol: none

- On a deployment without live mail, Invite User (Users, Members, Invitations, the organization page) and Resend Invitation no longer tell the admin to use Copy Invite Link. Accepting an invitation needs a verified email address, and without mail a password account cannot verify one, so a copied link only admits the sign-up. The message now says so: only an invitee whose social or SSO sign-in verifies the address can accept, and for anyone else a platform administrator creates the account (the operator path in the self-hosting guide). The translations carry the same text. Nothing else changes: the outcome, the action and Copy Invite Link behave as before.
- Import Users (cloud-managed environments) labels its `alreadyPending` count and column "Already pending" instead of "Already pending, told again". A deactivated pending person is re-added without the hosting organisation being told, so the old label contradicted the "Why not told: deactivated" cell beside it; whether the host was told is the "Hosting organization told" and "Why not told" columns' answer, as on Add User.
