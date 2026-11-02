---
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

fix(runtime,service-automation): a write in an action, hook or job body, or a flow record node, that landed under a failing roll-up answers its own success (#28861)

Clause-②: yes (widening)
Metadata-protocol: none

When a child write is stored but a parent's roll-up summary cannot be recomputed after it (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written"), the data doors and MCP tools already answer the write's success. The write surfaces an author's code holds now do the same, so the code's next line runs instead of stopping on a write that landed. Each answers exactly what the same write answers when every roll-up recomputes — no new code, member or shape:

- **`ctx.engine`** in an action handler: `insert` resolves `{ id }`, `update` and `delete` resolve. A multi-id `delete` deletes every id; a stale roll-up after one id no longer leaves the later ids undeleted.
- **`ctx.api`** in an action handler, and every context it derives (`sudo()`, `withRunAs(...)`, a `transaction(fn)` callback's context): each repository write verb resolves with the engine's result.
- **A sandboxed hook, action or job body's `ctx.api.object(...)`**: the write resolves in the body with the engine's result, so a hook no longer refuses the write that fired it, an action body returns its own value, and a job run reports its own outcome.
- **Flow `create_record`, `update_record` and `delete_record`**: the node succeeds with the output it gives on a clean write (`output`, `outputVariable`, `droppedFields`, `acted`), and the run goes on to its next node.

The stale summary column is logged at `error` once per field per process, with the fix, as on the data doors. A refusal raised before the write is stored (validation, permission, constraint) reaches the author's code exactly as before. No transaction is added: a body's earlier writes stay committed, as they always did. Inside a transaction the body opens itself (`ctx.api.transaction(fn)`), such a write now answers its success in the callback too, so that transaction commits where the refusal used to roll it back.

The REST and MCP action doors answer a refusal carrying a write's attached answer as the action's success only for a declarative update action, whose refusal carries the action's own result. Any other action that throws such a refusal is answered as the failure it is, and its invocation audit row records `failed`.
