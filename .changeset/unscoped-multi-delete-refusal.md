---
'@objectstack/objectql': minor
'@objectstack/service-storage': patch
---

Restore the #4757 unscoped multi-delete refusal on `sys_attachment` through the wired engine (#9719).

`ObjectQL.registerHook` gains an opt-in `dispatchUnscopedMultiDelete` declaration (valid on `beforeDelete` registrations only — anything else is refused at registration): when a `multi: true` delete arrives with no `where` at all (absent or `null`), the engine's predicate path dispatches the whole-operation context ONCE to declaring registrations — before any matched row is resolved, zero-match included — so a guard about the operation's shape can refuse it. Binding `input.id` on that context is refused (`HookTargetRebindError`, path `'unscoped-multi'`). Undeclared registrations, scoped deletes (including the match-all `where: {}`), and by-id deletes see no new dispatch.

The `sys_attachment` access guard declares the flag, so its documented refusal of a predicate-less multi-delete fires again with its declared envelope (`ATTACHMENT_DELETE_DENIED`, HTTP 403): since the per-row dispatch contract (#5038/#5574) that branch was unreachable, and a predicate-less `multi: true` delete quietly removed every row the caller happened to be entitled to. System-context and context-less programmatic deletes bypass the guard exactly as before.
