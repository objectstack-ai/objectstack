---
'@objectstack/plugin-security': minor
---

The registered `security` service serves `checkControlledByParentWrite(object, recordId, context)`, the ADR-0055 master-detail write check that `ISecurityService` declares as optional.

- **What it answers.** It answers what a by-id update of the record gets from the master-detail write check. It runs the write path's own composition and never re-derives it: the engine middleware's context prologue (a principal-less context, permission sets that cannot be resolved and a missing on-behalf-of delegator are refused with the same `403 PERMISSION_DENIED`), and then the check for the principal's permission sets and, on a delegated context, for the delegator's (ADR-0090 D10). The first refusal is the answer. A refusal resolves `deny` with the leg it came from, the three non-verdicts resolve `unresolvable` with their reason, and an object that is not `controlled_by_parent` resolves `not_applicable`. A system context resolves `allow`. A store fault rejects with the engine's own error, so a datasource outage keeps its `503`.
- **Where it differs from the write path's guard.** A principal whose permission sets resolve to none is judged over that empty list, so it answers `deny` on `object_permission` as the contract declares. A principal with positions or sets and no user id is also judged, where the write path skips the check. It answers `deny` when it holds no `update` grant on the master, and its own update is refused by the object-level gate anyway.
- **Who asks it.** The `sys_attachment` parent gate in `@objectstack/service-storage` and the `sys_comment` moderation gate in `@objectstack/plugin-audit` ask it, so they judge a `controlled_by_parent` parent through its master.
- The boot line that announces the `security` service now lists the members the registered service actually serves, read from the service object. The hand-kept list it replaced had fallen behind by five members.

Nothing an author writes changes, and no by-id write is judged differently. The middleware's context prologue moved into one method that the middleware and the member both call. Its refusals, their order and their wording are unchanged.
