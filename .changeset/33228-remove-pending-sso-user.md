---
'@objectstack/plugin-auth': patch
---

feat(auth): a cloud-managed environment can remove a pending person, cancelling their invitation at the host

Clause-②: yes (widening) — added: `POST /api/v1/auth/admin/remove-sso-user` (platform administrators, cloud-managed environments only); an optional `userRemoved` member on the environment-user host contract and the `'removed'` event kind; the `'deactivated'` value of the host outcome's `reason`. Nothing that was accepted is refused.
Metadata-protocol: none

On a cloud-managed environment, a person added to sign in through the hosting organisation's identity provider stays pending until their first sign-in. Before this change a pending person with a typo in their email could only be deactivated.

**Removing a pending person.** `POST /api/v1/auth/admin/remove-sso-user` with `{ "userId": "…" }` asks the host first, outside any transaction, then removes the person with their positions, permission sets and membership in one unit of work:

- The host is told through `userRemoved`. A host without it is told through `userDeactivated` with `source: 'idp_pending'`, which already means "cancel the invitation". A host should implement `userRemoved`.
- A host refusal (403/409) answers with the host's sentence, and no one is removed.
- A host that cannot be reached refuses the removal with `503 SERVICE_UNAVAILABLE`, and no one is removed: the door calls the host once and keeps no record to ask again from, so try again. Durable retry is the host's job.
- With no host wired, the person is removed and the answer says `host: { notified: false, reason: 'no_host' }`.
- A person who is not pending answers `409`: deactivate them instead. This holds at the removal itself: the person is re-checked inside the unit of work and the delete carries `source: 'idp_pending'`, so a person whose first sign-in lands while the host is asked is not removed. On an object with cascading lookups (such as `sys_user`) the engine re-deletes by id after the cascade, so a first sign-in committing in that narrow window is not yet refused.
- A person that other records still point at (`deleteBehavior: 'restrict'`) answers the engine's refusal, and nothing is removed. If the host had already cancelled the invitation of a person who is still pending and not deactivated, the door sends it again through `userAdded`, once, and the answer says whether that worked.
- An unknown id answers `404`; a body with any key but `userId` answers `400`. Off a cloud-managed environment the door answers `409` and removes no one.

**A deactivated person is never sent an invitation.** Adding a deactivated pending person again no longer calls `userAdded`; the answer says `host: { notified: false, reason: 'deactivated' }`. Reactivating them (`admin/unban-user`) is what tells the host again.

Nothing to migrate.
