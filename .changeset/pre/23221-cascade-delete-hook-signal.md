---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/runtime': minor
---

A hook can now tell a child delete that a parent's cascade issues from a hand delete: `HookContext.referentialCascadeDelete`, the delete twin of `referentialFieldClear`

Clause-②: yes

When a record is deleted and a relation whose `deleteBehavior` resolves to `cascade` (a `master_detail` unless it declares `restrict`, or a `lookup` / `tree` that declares `cascade`) removes its children, the engine deletes each child as the calling user. The child's `beforeDelete` and `afterDelete` hooks therefore saw the same `ctx.user`, `ctx.session` and `ctx.input` as a user deleting that one child by hand. A guard that freezes settled records, such as a quote's lines once the quote is accepted, could refuse both deletes or neither, and refusing both made the parent, and every record whose cascade reaches it, undeletable.

- **What the key means.** `ctx.referentialCascadeDelete === true` exactly on a delete the engine's cascade issued: the child delete, in both phases, at any depth (a grandchild that the child's own cascade removes is marked too). It is absent, never `false`, on every other delete: the delete the caller asked for, a user's hand delete of the same child, and any write a hook issues through `ctx.api` during a cascade, deletes included. The `set_null` cleanup update keeps `referentialFieldClear` and never carries this key, and a cascade child delete never carries `referentialFieldClear`.
- **The guard idiom.** Refuse a hand delete of a frozen line and yield to the cascade:

  ```ts
  if (ctx.referentialCascadeDelete !== true && ctx.previous?.locked === true) {
    throw new Error('This line belongs to a settled quote and cannot be deleted.');
  }
  ```

- **Only the declared key is the contract.** There is no operation-private (`__`-prefixed) spelling of this fact on the execution context. The engine recognises the delete its cascade issued through an engine-private record keyed on that child's object and id, so nothing on `ctx.api`, `ctx.transaction` or any `__` key can stand in for it. Read `ctx.referentialCascadeDelete`.
- **In a sandboxed hook body.** The key is carried across the QuickJS boundary by contract, so a lowered `*.hook.ts` body reads `ctx.referentialCascadeDelete` exactly as an in-process handler does.
- **spec (minor):** `HookContextSchema` declares `referentialCascadeDelete` (boolean, optional). One optional engine-produced key on the non-strict runtime hook context; nothing previously valid changes meaning.
- **objectql (minor):** `delete()`'s hook-context assembly sets the key on the delete the cascade walk issues. The walk still hands the child the caller's context unchanged, so no other hook-context member moves.
- **runtime (minor):** `buildSandboxContext` and `installCtx` carry the key into the VM.
