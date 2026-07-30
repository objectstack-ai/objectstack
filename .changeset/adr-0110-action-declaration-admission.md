---
'@objectstack/runtime': major
'@objectstack/objectql': minor
'@objectstack/metadata': minor
---

**ADR-0110 — an action's identity is its `name`, and anything executable over a
governed surface must have a declaration.**

`POST /api/v1/actions/:object/:action` resolved the DECLARATION from the URL
segment as a `name` but dispatched the HANDLER using that same segment as a
registry key. For a target-bound action (`{ name: 'complete_task', target:
'completeTask' }`) those are different strings, so the two documented callers
each worked on exactly the half the other broke: the documented curl resolved
the declaration then 404ed, while the Console's `target`-addressed call
dispatched fine and resolved no declaration — silently skipping the ADR-0066 D4
capability gate and the ADR-0104 param contract (#3935).

- **D1/D2** — identity is always the declarative `name`; the handler key is
  derived from the resolved declaration through a rotation now shared with the
  MCP `run_action` bridge (`resolveActionHandlerKeys`, `executeRegisteredAction`).
  The REST route previously rotated only the object key, never the handler key.
- **D3 (breaking)** — declaration resolution is a trichotomy. A genuinely
  undeclared handler is **refused (404)** with the `defineAction` to add, rather
  than executed ungated with system privileges; an unreachable metadata plane is
  a **503** rather than a silent ungating (`MetadataManager.loadDiagnosed` tells
  a clean miss from an outage). `OS_ALLOW_UNDECLARED_ACTIONS=1` is the migration
  valve — it warns on every invocation and is removed in 18.
- **D5** — `reconcileActionRegistrations` plus `ObjectQLEngine.listRegisteredActions`
  power a `kernel:ready` inventory logging every registered-but-undeclared
  handler (refused at dispatch) and every declared script action bound to no
  handler — the ADR-0078 converse, mechanised.
- **D6** — security-gate strictness is opt-**out** (`OS_ALLOW_*`), never opt-in.

Apps whose actions are all declared need no changes beyond gaining enforcement
of the `requiredPermissions` they already declared.
