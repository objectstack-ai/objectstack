---
'@objectstack/plugin-audit': patch
---

Restore the #4630 unscoped multi-delete refusal on `sys_comment` through the wired engine.

`ObjectQL.delete('sys_comment', { multi: true })` with no `where` at all silently deleted
every comment the caller was entitled to, instead of being refused outright as declared.
The per-row dispatch contract (#5038/#5574) binds `input.id` on every `beforeDelete`
dispatch of a predicate delete, so the guard always took its by-id branch — and a
zero-match predicate dispatched nothing at all, so the guard never ran.

The `sys_comment` access-hook registration now declares `dispatchUnscopedMultiDelete`
(the engine mechanism added in #9719), so the whole-operation context reaches the handler
once, before any row is resolved, zero-match included. An unscoped `multi: true` delete of
comments is now refused with `RECORD_NOT_ACCESSIBLE` / 403. Scoped deletes are unaffected:
by id, by a real `where`, and the match-all `where: {}` all behave exactly as before —
only an absent or `null` predicate is refused.

The unscoped multi-**update** half of the same guard is unchanged and still not reachable
through the wire; it is tracked as its own decision card (#9974).
