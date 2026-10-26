---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-core': minor
'@objectstack/metadata': minor
'@objectstack/plugin-security': minor
'@objectstack/plugin-sharing': minor
'@objectstack/plugin-approvals': minor
'@objectstack/lint': minor
'@objectstack/runtime': minor
'@objectstack/platform-objects': minor
'@object-ui/app-shell': minor
'@objectstack/skills': minor
---

feat: ownership queues: records wait in a queue until a member claims them, and assignment rules route new records (ADR-0142)

Clause-②: yes
Metadata-protocol: added

Two enum additions: `ShareRecipientType` gains `queue` (a sharing rule can now name a queue as its recipient), and the `queue` approver type is authorable again (it leaves `NON_AUTHORABLE_APPROVER_TYPES`, so it is no longer marked deprecated). Two metadata types are new: `queue` and `assignment_rule`.

- **`@objectstack/spec`**: new `queue` and `assignment_rule` metadata types (`QueueSchema`, `AssignmentRuleSchema`) and the stack keys `queues` and `assignmentRules`. A declared queue's members are positions. New `IOwnershipQueueService` contract, registered under `ownership-queue`. `queue` joins the injected system columns of `ownership: 'user'` objects and `PUBLIC_FORM_SERVER_MANAGED_FIELDS`. `APPROVER_VALUE_BINDINGS.queue` reads both a declared queue and an organization's `sys_queue` row, and `APPROVER_ORG_SCOPED.queue` is `true`. The explain rule kinds `queue_membership` and `queue_claim` are new. `QUEUE_NOT_FOUND` (422) is registered under plugin-security.
- **`@objectstack/objectql`**: objects with `ownership: 'user'` get a system-managed `queue` column beside `owner_id`. Declaring your own `queue` field on one is refused at registration (`INVALID_METADATA`). An update can carry a write precondition: when it no longer matches, the update answers `409 CONCURRENT_UPDATE`. Declared assignment rules run once for each inserted row that has no owner and no queue after the `beforeInsert` hooks. A rule can park the row in a queue, or pick a member by `round_robin` or `least_loaded`. Assignment never refuses an insert. `kernel:ready` refuses to boot a stack that declares queues or assignment rules when no `ownership-queue` service is registered.
- **`@objectstack/metadata-core`**: `queue` is classified as an injected system column.
- **`@objectstack/metadata`**: the artifact door registers a stack's `queues` and `assignmentRules`, so an artifact-only runtime serves them.
- **`@objectstack/plugin-sharing`**: three new objects, `sys_queue`, `sys_queue_member` and `sys_assignment_cursor`, and the `ownership-queue` service. The service resolves a queue name from the registry first, then from the organization's own rows, and has one member expander. A record with no owner that sits in a queue can be read and edited by the queue's members, never deleted. The `queue` sharing recipient grants matched records to the queue's members, and its grants are recomputed when membership changes or the queue is switched on or off.
- **`@objectstack/plugin-security`**: the owner gate handles `queue`. A **claim** sets `owner_id` from empty to yourself, by id. It is admitted when the sharing model allows you the record, and only one claimant wins: the loser gets `409`. A **release** gives your own record back to its home queue. A **move** to another queue needs the transfer grant, and a queue name that does not resolve is refused with `422 QUEUE_NOT_FOUND`. An insert that names a queue needs the transfer grant or membership of that queue. A guest can supply neither. Explain reports the queue reasons on the sharing layer.
- **`@objectstack/plugin-approvals`**: a `queue` approver resolves to the queue's members when the step opens. An empty queue adds nobody and logs a warning. The `queue:<name>` placeholder is never written again.
- **`@objectstack/lint`**: a queue-only approval node is reported `approval-approvers-may-resolve-empty`, and the org-axis red line admits the queue recipient. Two new advisory rules come with `os explain` entries: `assignment-rule-user-target` (warning) and `assignment-rule-queue-unstaffed` (info).
- **`@objectstack/runtime`**: `POST /security/_activation/:type/:name` also switches a declared `queue` or `assignment_rule` on and off.
- **`@objectstack/platform-objects`**: the two new metadata types' labels, and the queue recipient option, are translated in zh-CN, ja-JP and es-ES.
- **`@object-ui/app-shell`**: the flow designer no longer warns that a queue approver resolves to nobody.
- **`@objectstack/skills`**: the platform skill lists `queues` and `assignmentRules` among the stack's top-level keys.

What to do: nothing for existing stacks, which behave as before. To use queues, declare `queues` and `assignmentRules` in your stack, and make sure plugin-sharing is installed: it registers the `ownership-queue` service.
