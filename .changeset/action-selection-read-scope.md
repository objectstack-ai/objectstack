---
'@objectstack/runtime': patch
---

fix(runtime)!: an action's selection is read in the caller's scope before the action runs

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the answer the action doors (REST `POST /api/v1/actions/...`, MCP `run_action`, a host's `dispatchAction`) give a call whose `params._selectedIds` or whose param bag a param-less action does not accept: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

The rule: a call names records by id only when the caller can read them. The per-record door already reads its `recordId` in the caller's own scope; a record-less call that carries a selection (`params._selectedIds`, the aggregate bulk dispatch) now has every id read the same way — with the per-record door's own read, as a row of the object the call names — before a script body or a flow starts.

**BREAKING** for a caller of a `type: 'script'` or `type: 'flow'` action whose call carries `params._selectedIds`, and for a caller of a param-less handler action that sends a near-miss spelling of a built-in param.

- FROM: such a call was dispatched as sent.
- TO:
  - a selection with any id the caller's scope does not deliver is refused whole with `404 RECORD_NOT_FOUND` (the per-record door's answer; a hidden row and an id that names nothing answer alike), and nothing runs;
  - a selection that is not a list of record ids, that names more than 5000 of them, or that is sent to an action called on no object is refused with `400 VALIDATION_FAILED`;
  - on a param-less action, `selectedIds`, `__selectedIds`, `_recordId` and `_objectName` are refused with the param contract's own `400`, naming the built-in they miss by one underscore. Every other custom key still passes to the handler (ADR-0104 D2).

**Not moved.** A declarative `operation: 'update'` action (it writes as the caller), a `type: 'api'` action (its target authorizes the caller) and a call made as the system principal are not read. A selection the caller can read whole reaches the handler exactly as sent, repeated ids included; a row the caller can read by its id is never refused as part of a selection.

The fix for a caller: send only ids the caller can read, at most 5000 per call, under the built-in key `_selectedIds`. A body that writes each selected row is best declared `execution: 'perRecord'`, so each dispatch hands it that row as `ctx.record`.
