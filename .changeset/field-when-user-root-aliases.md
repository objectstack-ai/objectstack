---
"@objectstack/lint": patch
---

fix(lint): the field-level user-root rejection covers all three ADR-0068 spellings, not just `current_user` (#6585)

#6290 gave field-level `visibleWhen` / `readonlyWhen` / `requiredWhen` a
surface-level rejection when the predicate reaches for the signed-in user, with
a prescription that names surfaces which actually bind one. That check matched a
single spelling — `current_user` — while ADR-0068 D1 makes `user` and `ctx.user`
**the same object under different names**: `buildScope` hangs one `EvalUser`
reference on `current_user` / `user` / `ctx.user` / `os.user`. So the identical
semantic error produced an error under one spelling and **total silence** under
the other two (both have always been in `SCOPE_ROOTS`, so the bare-reference
check never fired on them either). Which of three ADR-equivalent spellings the
author happened to pick decided whether they got a build-time diagnostic at all.

The failure direction is the one #6146 named: an unbound root faults, the fault
falls back, and visibility's fallback is `true` — so a predicate written to HIDE
a field by role left it visible to everyone, silently.

All three roots now share one verdict, one prescription and one message; only
the root named in the message varies. Nothing about the option level changes:
per-option `visibleWhen` resolves against the host's predicate scope, which
binds the user under every spelling, so the showcase's role-gated option
(`'admin' in current_user.positions`) stays legal — under the aliases too.

**`ctx` is judged as a whole root, not only in `ctx.user` form.** At this
surface that is simply what is true: `buildScope` creates the `ctx` root *only*
when the evaluation carries a user, and no field-level site passes one — the
server binds `record` + `previous` (+ `parent`) and the client's
`evalFieldPredicate` binds `record` + `previous` + a caller scope that is only
ever `{ parent }`. `ctx.locale` therefore faults exactly like `ctx.user.id`
here. The narrower reading was rejected because it needs a source-level spelling
match, which would re-open this very fork one level down (`ctx["user"].id`
silent, `ctx.user.id` rejected) while leaving a real fail-open fault
unreported. `ctx` remains ActionEngine's predicate root elsewhere and is
untouched there — the platform's own `ctx.user` predicates all sit on action
`visible` (`sys-user.object.ts`, `sys-invitation.object.ts`), a surface this
rule never reads, and that acceptance is pinned.

Sweep: field-level `*When` predicates reading any user root measure **zero**
across `examples/`, `packages/` and the downstream `objectui` repo, by both a
slot-keyed scan and an alias-keyed one — so no shipping metadata is refused by
the widening. `objectstack validate` stays clean on all three example apps.
