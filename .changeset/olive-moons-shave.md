---
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
---

Fix `POST /api/v1/auth/admin/remove-user`, which could never succeed and left the identity un-authenticatable when it failed.

Three compounding problems on the better-auth admin removal path:

- **`sys_member.user_id` declared no `deleteBehavior`.** A `lookup` defaults to `set_null`, and the engine escalates a defaulted `set_null` on a REQUIRED foreign key to `restrict` — so the membership every user gets at sign-up (and, since the invitation-adoption change, keeps after accepting an invitation) vetoed every `sys_user` delete. The field now declares `deleteBehavior: 'cascade'`. The last-administrator invariant is unaffected: it is enforced by a `beforeDelete` hook on `sys_member`, and the engine's cascade recurses through the public `delete()`, so that hook still runs.
- **The removal was not atomic.** better-auth deletes the sessions, then the accounts, then the user, in three calls with no transaction, so anything refusing the last one left the credential rows deleted and the user row behind — an identity still on the org roster that can no longer sign in. Subject-erasure requests now run inside one engine transaction and roll back as a unit. Datasources whose driver has no transaction support keep the previous behaviour and log the engine's existing warning.
- **A referential refusal reached the client as an HTTP 500 with an empty body.** The auth adapter mapped engine validation errors and policy refusals to better-auth `APIError`s but not referential ones, so a `DELETE_RESTRICTED` escaped unmapped. It now surfaces as a structured 409 carrying the dependent object, the dependent count and the remedy.
