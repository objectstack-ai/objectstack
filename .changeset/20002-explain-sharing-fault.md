---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security/explain` fails closed when a dependency it shares with enforcement throws, so a request that fails is no longer reported as allowed (#20002)

Clause-②: no

`POST /api/v1/security/explain` calls the same functions as the enforcement middleware. Enforcement does not catch a failure in them, so the request fails. The explain engine caught the same failure and turned it into a value that it then read as an answer. So when the sharing service's share store was unavailable, `{ object, operation: 'read', recordId }` answered `decision.record.visible: true` (`decidedBy: 'sharing'`, sharing layer `admitted`), and the caller's `find` for the same row threw. Four call sites had this problem:

- **The sharing read filter** (the reported case). A failure became `null`, which the record matcher reads as "no filter". So an unshared row, a shared row, and the caller's own row were all reported visible.
- **The sharing service's per-record `update` / `delete` gate.** A failure became "no gate wired", so ownership, a `read` share or the OWD answered a write that the by-id `PATCH` / `DELETE` then failed on.
- **The layered row-level security composition.** A failure became "no tenant wall and no business RLS". The row was reported visible, while `allowed` was `false` because of the same failure.
- **An on-behalf-of delegator whose grants could not be read.** A failure became "no delegation", so the agent's own grants decided alone and `allowed` was `true`. The same `find` answered `503 SERVICE_UNAVAILABLE`.

Each failure is now reported as it happened. The affected layer's `record.outcome` is `not_evaluated`, with no `rowFilter` and no `matchesRecord`, and its `detail` says the layer could not be evaluated. `record.visible` is `false`, and `decidedBy` names the layer that failed: `sharing`, or `rls` for the composition. For the delegator case, the `principal` and `object_crud` layers deny and `allowed` is `false`. The response has no new keys, and `not_evaluated` is an existing outcome value.

Unchanged:

- Enforcement admits and refuses exactly what it did before.
- A dependency that answers is reported exactly as before. That includes a read filter that answers "no restriction", such as an `org`-depth reader's `null`.
- Failures that already failed closed are unchanged: record fetch, share listing, and permission-set resolution for the principal or the delegator.
