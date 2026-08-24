---
"@objectstack/plugin-audit": minor
"@objectstack/plugin-approvals": minor
"@objectstack/plugin-sharing": minor
---

Four more system objects declare their polymorphic pointer pair (#11386, ADR-0052 §5, adopting the carrier #11339 landed): `sys_audit_log.record_id`, `sys_approval_request.record_id`, `sys_record_share.record_id` and `sys_share_link.record_id` now carry `referenceVia: 'object_name'`. A seed row addressing one of these by the target's natural key resolves against the object its sibling column names, per row — so a packaged app can ship audit history, pending approvals, record grants and share links that actually attach to the records they are about, and the queries that give each row its meaning (the `{object_name, record_id}` index, the pending-request lock, the sharing middleware's grant lookup, the share link's fail-closed record-existence gate) match on the target's real id.

The accept/reject contract changes with it on those four objects, deliberately and in the already-ruled direction: an unresolvable pointer on a DECLARED pair is a loud, counted failure instead of the old silent verbatim store. On a grant table that is the sharper win — a share whose `record_id` stayed a natural key enforced nothing while displaying as a grant, and was then deleted by the orphan sweep for describing a record that does not exist. Internal-id-shaped values still pass through verbatim, so a demo row about an already-deleted record (an `action: 'delete'` audit row) stays authorable. Undeclared text columns are untouched.

The fifth object surveyed, `sys_automation_run` (`trigger_object` / `trigger_record_id`), deliberately STAYS UNDECLARED. Its pair has the same shape but its rows are not content about a record: a `paused` row is a live continuation the engine rehydrates on boot, terminal rows are telemetry under a 30-day sweep, and the object has no natural key to address rows by. The verdict, its reasons, and what would have to change to flip it are recorded on the field itself and pinned by a test.
