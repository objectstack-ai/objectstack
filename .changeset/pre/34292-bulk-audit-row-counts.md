---
'@objectstack/runtime': patch
'@objectstack/plugin-audit': patch
---

fix(audit): the action invocation row of an aggregate bulk call records how many selected rows succeeded, failed or were not confirmed

Clause-②: yes
Metadata-protocol: none

An `execution: 'aggregate'` bulk action is one call for the whole selection, with the ids in `params._selectedIds`. When its handler moved some rows and failed others, it resolves with a `BulkActionResult` (`{ succeeded: [ids], failed: [{ id, message }] }`, `@objectstack/spec/ui`) and does not throw. The `action_invocation` row in `sys_audit_log` recorded only `outcome: 'succeeded'` for that call, so the audit trail said a partly failed run fully succeeded.

The outcome stays `succeeded`. When the call carried `_selectedIds` and its resolve value carries a `succeeded` or `failed` member, the row's `metadata` now also records what that value reads as under `BulkActionResultSchema`, counted by the rules the console's bulk dialog counts with: an id outside the selection is dropped, a duplicate counts once, an id in both lists counts as failed, and a selected id in neither list is not confirmed.

- `bulk_selected`, `bulk_succeeded`, `bulk_failed` and `bulk_unconfirmed`, where `bulk_selected = bulk_succeeded + bulk_failed + bulk_unconfirmed`;
- or, when the value carries a member but does not parse, `bulk_unreadable: true` alone and no succeeded count.

A handler that resolves with nothing, or with a value that has neither member (a summary, a download link), records the row as before. A call with no `_selectedIds`, a failed call and a `resume_run` add no bulk key. Both the REST `POST /actions/:object/:action` door (and a host's `dispatchAction`) and the MCP `run_action` tool record the counts.

`ActionInvocationAuditEvent` gains an optional `bulk` member in both packages, and `@objectstack/plugin-audit` exports its type, `ActionInvocationBulkReading`. A reader of the ledger that lists `metadata` keys sees the new keys on these rows only.
