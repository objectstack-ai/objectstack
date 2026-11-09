---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

The Setup → SSO Providers forms now set the groups claim an SSO sign-in grants permission sets from. It is stored where `POST /api/v1/auth/sso/register` stores it, the provider's `mapping.extraFields.groups`, and nowhere else.

- **Register SSO Provider** takes **Map: Groups claim** and **Register SAML Provider** takes **Map: Groups attribute**. Left blank, the provider maps no groups, as before.
- **Show Groups Claim** (`POST /api/v1/auth/admin/sso/get-groups-claim`) shows a provider's claim, including one the register door wrote.
- **Edit Groups Claim** (`POST /api/v1/auth/admin/sso/set-groups-claim`) sets it, or removes it when blank. It writes through `/sso/update-provider` and keeps every other mapping member as stored.

Both new routes run the platform-admin gate of the other `/admin/sso` bridges and answer only `{ providerId, groupsClaim }`.
