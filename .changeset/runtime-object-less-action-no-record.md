---
'@objectstack/runtime': patch
---

fix(runtime)!: an action not bound to an object accepts no record

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or re-shaped, and no stored row, registry key or authored value changes. What moves is which action calls are admitted; there is nothing for a migration to rewrite. -->

**BREAKING** — which calls an object-less action admits. One rule, judged on the action's own declaration, at every door that runs an action: REST `POST /api/v1/actions/:object/:action` (with or without a package namespace or a record id in the path), the MCP `run_action` tool and a host's `dispatchAction`.

- FROM: a call to an action declared on no object could carry a `recordId`, and, when called under an object's name, a `params._selectedIds`; either was handed to the action.
- TO: an action declared on no object accepts no record. A call to one that carries a `recordId` or a `params._selectedIds` is refused `400 VALIDATION_FAILED`, the key named in `error.details.fields[0].field`, before any record is read and before the action runs. It holds for every caller and every action type, whatever object the call is routed under, and with no object at all.
- An action declared on an object, in its `actions` or as a standalone action naming its `objectName`, is unchanged: its `recordId` is loaded and its selection is read in the caller's own scope first, as before.
- An object-less action called with neither key runs as before.

The fix for a caller: leave the record key out of a call to an object-less action. To act on records, declare the action on their object and call it there.
