---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
'@objectstack/cli': patch
---

feat(auth): a cloud-managed environment can remove a pending person, cancelling their invitation, and every call to the environment-user host is retried from a durable outbox

Clause-②: yes (widening) — added: `POST /api/v1/auth/admin/remove-sso-user` (platform administrators, cloud-managed environments only) removes a person who is still pending (`sys_user.source = 'idp_pending'`) and cancels their invitation at the host; the environment-user host contract gains an optional `userRemoved` member and an optional `deliveryId` on every event; the add, import, ban and unban answers gain an optional `invitation: { id, status }`; a new read-only system object `sys_environment_user_outbox` records each call. Nothing that was accepted is refused, and no existing answer field changes.
Metadata-protocol: none

On a cloud-managed environment, a person added to sign in through the hosting organisation's identity provider stays pending until their first sign-in. Before this change a pending person with a typo in their email could only be deactivated, and a host call that failed (a network error, a host outage) was logged and lost.

**Removing a pending person.** `POST /api/v1/auth/admin/remove-sso-user` with `{ "userId": "…" }` asks the host first, then removes the person in one unit of work:

- The host is told through `userRemoved`. A host without it is told through `userDeactivated` with `source: 'idp_pending'`, which already means "cancel the invitation". A host should implement `userRemoved`.
- A host refusal (403/409) answers with the host's sentence, and no one is removed.
- A host that cannot be reached does not block the removal. The cancellation is queued and retried.
- With no host wired, the person is removed and the answer says `host: { notified: false, reason: 'no_host' }`.
- A person who is not pending answers `409`: deactivate them instead. A person that other records still point at (`deleteBehavior: 'restrict'`) answers the engine's refusal, and nothing is removed. If the host had already cancelled the invitation, a re-send is queued so they stay pending as before.
- On an environment that is not cloud-managed the door answers `409` and removes no one.

**Outbox.** Every call to the host about a person (invited, deactivated while pending, re-sent on reactivation, removed) writes a row to `sys_environment_user_outbox`. The door that acts still makes the first call itself, outside any database transaction, so a typed refusal (such as the developer member cap) still reaches the administrator on that request. A call the host did not take stays `pending` and a worker retries it, backing off from one minute to twelve hours, until the host takes it or twelve attempts fail (`failed`, logged as an error). A typed refusal on a retry ends the row as `failed` with the host's code and sentence, and the person stays pending. The worker starts only on a cloud-managed environment with a host wired. Each call carries the row id as `deliveryId`, so a host can drop a repeat. The newest row of a person is their invitation status, which Setup → Users reads through the data API (`get` / `list`, platform administrators only). An `added` row becomes `accepted` when the person first signs in.

Nothing to migrate. A host that ignores `deliveryId` keeps working: repeats of the same call already happen today when a person is re-added.
