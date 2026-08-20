---
'@objectstack/objectql': minor
'@objectstack/plugin-audit': minor
'@objectstack/service-storage': patch
---

**Behaviour change:** an unscoped `multi: true` UPDATE of `sys_comment` is now refused, where it previously succeeded for a caller entitled to every row (#9974).

This is not the restoration of a guard that used to work — it is a deliberate narrowing of what the engine accepts, ruled by the maintainer on 2026-08-19. If you issue `ql.update('sys_comment', data, { multi: true })` with **no `where` at all**, that call works today and will start failing with `RECORD_NOT_ACCESSIBLE` / 403. **The fix at the call site is to say which rows you mean** — pass a `where`. The explicit match-all `where: {}` is still accepted and still authorizes every matched row individually; only an *absent* or `null` predicate is refused.

Why the accept set narrowed rather than the declaration: `resolveTargetRows` has declared this refusal for both write verbs since #4630, but on update it could only ever fire by accident — when the sweep happened to touch a row the caller lacked rights to, and then with a per-row message (`Cannot update comment c2: …`) naming a row rather than the shape. A caller who owned every row had the whole table rewritten, and a zero-match probe resolved silently. A guard that fires by accident reads as enforcement while enforcing nothing. The ruling weighed recoverability: a delete leaves a trace of who removed what, an overwrite leaves none — the old value is gone on the spot with nothing to restore from — and a forgotten `where` is the mistake generated code makes most often.

**Engine (`@objectstack/objectql`).** #9719's opt-in whole-operation dispatch now covers `beforeUpdate`'s predicate path as well as `beforeDelete`'s, and the registration flag is **renamed** `dispatchUnscopedMultiDelete` → **`dispatchUnscopedMultiWrite`** (one flag generalized to both events rather than a second flag; it is per-registration and per-event, so a delete-only guard still says "delete only" by declaring it on `beforeDelete` alone). Declaring it on any other event is still refused at registration time. Binding `input.id` on the whole-operation context is refused on both verbs (`HookTargetRebindError`, path `unscoped-multi`), and the error now names the caller's event.

**Blast radius.** The dispatch is delivered ONLY to registrations that declare the flag, so `sys_comment` is the only object whose update accept set changes; every other object's unscoped `multi: true` update behaves exactly as before. `sys_attachment` keeps its delete-only declaration and is unaffected on update. A repo-wide structural sweep of 4 663 source files found no in-tree caller — none in `examples/`, none in the dogfood apps, none in `packages/` source — that issues an unscoped `multi: true` update against a declaring object.

**`@objectstack/service-storage`** is a rename-only follow: its `sys_attachment` guard declares the renamed flag on the same event, with the same behaviour.
