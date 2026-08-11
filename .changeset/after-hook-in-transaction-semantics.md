---
"@objectstack/spec": patch
"@objectstack/objectql": patch
---

docs(spec,objectql): declare that `after*` hooks fire inside the unit of work (#7477)

`afterInsert` / `afterUpdate` / `afterDelete` are dispatched **before** the
enclosing transaction commits. What that guarantees has never been written
down, and the two readings differ in exactly the case that matters — so it is
now declared, on the API surface and in the docs, per the maintainer ruling on
#7477.

**The declared meaning:** an `after*` hook means *"the write has been requested
and will happen unless this unit of work is undone"* — not *"the write
happened"*. A later refusal inside the same unit rolls the row back after the
hook has already run.

Three ordinary operations put a write inside such a unit:

- a by-id `delete()` whose cascade is atomic — each **cascaded child's**
  `afterDelete` fires inside the wrap the parent opened (#7413); the parent's
  own `afterDelete` runs after that unit closes and is unaffected;
- `batchData` / `deleteManyData` with `atomic: true` — every member's `after*`
  fires inside one transaction that aborts on the first failure (#4620);
- any caller that wrapped the write in `engine.transaction()` /
  `ctx.api.transaction()`.

**What it means for a handler.** Effects routed back through the engine
(`ctx.api`, `ctx.ql`) join the same transaction and roll back with everything
else — that is what makes an in-engine audit or projection hook correct.
Effects that leave the engine — webhooks, notifications, external index
updates, file deletion — are the handler's own responsibility to make
rollback-tolerant: idempotent and reconcilable, or handed to a worker that
re-reads the record instead of trusting the event alone.

**No behaviour change.** Nothing about when a hook fires moved; the alternative
(deferring `after*` to commit) was considered and rejected in the same ruling,
because it would push a handler's own `ctx.api` writes outside the transaction
the write ran in. The statement lands as JSDoc on `HookEvent` and
`HookEventType` in `@objectstack/spec`, on `DISPATCHABLE_HOOK_EVENTS`,
`HookHandler` and `triggerHooks` in `@objectstack/objectql`, and as a new
section on the Hooks documentation page. The existing #7413 pin already
asserted this ordering; its comment now records the ruling instead of leaving
the question open.
