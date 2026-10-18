---
'@objectstack/runtime': minor
---

fix(runtime)!: an `operation: 'update'` action that declares no `params` refuses every undeclared wire param at both action doors, instead of writing it to the row

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes, and no stored shape, is added, removed, renamed or converted: the change is which wire params the two action doors accept for one declared action shape. No spec schema changes, so nothing exists for `objectstack migrate meta` to rewrite. A request is not metadata, and whether a value the client sends should become a declared param is a decision only the action's author can make. -->

**BREAKING** (the REST `/actions` door and the MCP `run_action` door now refuse, with a 400 `VALIDATION_ERROR`, a wire param that a declarative update action without `params` does not declare; measured consumers: objectstack-ai/hotcrm's `complete_task` called with such params, and any console vendored before objectui `fb501bc894`, which posts the action's `patch` keys as `params`), shipped as `minor` under the launch-window convention for breaking changes.

A declarative update (`operation: 'update'` + `patch`) has no handler: the route merges the request's `params` over `patch` and writes the result to the current record. An action that declared no `params` skipped the ADR-0104 D2 param check altogether, so any key the caller sent was written too. An action declaring `patch: { status: 'completed' }` could rewrite any other field the caller may write, which is not what its author declared.

Now an empty or absent `params` list on a declarative update is an empty accept set. Every key that is neither a declared param nor a dispatcher built-in (`recordId`, `objectName`, `_selectedIds`) is refused before anything is read or written, through the same D2 path a declared-params action already takes: the same `Invalid action params: Unknown action param "KEY"` message, the same 400, and the same `OS_ALLOW_LAX_ACTION_PARAMS=1` escape hatch. The action still writes its `patch` when the request carries no `params` or an empty bag, and a declared param still writes and still wins over `patch`.

Unchanged: an action with a handler (`target`, `body`, or a flow) that declares no `params` keeps its pass-through.

Also at the MCP `run_action` door: every ADR-0104 D2 param refusal now carries `code: 'VALIDATION_ERROR'` and `status: 400`, so the tool error renders the coded envelope the REST door already answers with, rather than the message alone.

What to do: declare the param on the action if the request's value should be written, or stop sending it, because the route applies `patch` from the declaration and never needs it on the wire.
