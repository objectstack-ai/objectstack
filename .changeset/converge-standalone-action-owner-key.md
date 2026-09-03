---
"@objectstack/objectql": minor
"@objectstack/runtime": patch
---

refactor(objectql,runtime): give the standalone-action owner-key ladder one spelling (#14422)

`action.objectName` -> `action.object` -> the object-less `'global'` key decides
which engine key a standalone `action` declaration is filed under. It was
written out three times — `standaloneActionOwnerKey` in
`packages/objectql/src/action-governance.ts`, `standaloneActionObjectName` in
`packages/runtime/src/action-execution.ts`, and a private
`ObjectQLPlugin.actionObjectKey` — and the only thing holding the three equal
was a sentence in each docblock saying it must stay in lockstep with the
others. #14123 was already the bill for that shape: two readers of "where does
this declaration live" answering from different code.

All three now resolve to the one implementation. The plugin calls
`standaloneActionOwnerKey` directly (same package, four call sites, not the one
the card estimated); the runtime re-exports it in the ADR-0110 block that
already exists in that file for exactly this purpose, alongside
`GLOBAL_ACTION_OBJECT_KEY`, `isObjectLessActionKey` and the rest. No behaviour
moves: the three ladders were measured equivalent across a twelve-row truth
table before the change.

**The divergence this removes was real, not hypothetical.** The plugin's copy
terminated on a bare `'global'` string literal while the other two return the
shared `GLOBAL_ACTION_OBJECT_KEY` constant. The constant is `'global'` today, so
the three agreed and nothing was broken — but the plugin copy was the one that
would have parted from the others in silence the day that constant moved, and
no test in the repo would have caught it. The same literal in the plugin's
`isArtifactShippedAction` reader is converged to the constant with it.

**`_deps`: kept, as a delegating alias — not dropped.** The engine helper is
`standaloneActionOwnerKey(action)` and the runtime's name is
`standaloneActionObjectName(_deps, action)`. `_deps` was already unused, but
dropping it would move an EXPORTED signature to save two characters at the two
in-repo call sites, both of which live in `action-execution.ts` itself. The
alias keeps its arity and its meaning, so `ownsRoute` and any out-of-repo
importer compile and behave exactly as before; its body is now
`return standaloneActionOwnerKey(action);` and nothing else.

**Levels, and the instrument.** `@objectstack/objectql` is `minor` because
`standaloneActionOwnerKey` had to be added to its published entry
(`src/index.ts`) for the runtime to import it at all — measured in the built
`packages/objectql/dist/index.d.ts`, where the name is now both declared and
exported. `@objectstack/runtime` is `patch`: `action-execution.ts` is not
re-exported from `packages/runtime/src/index.ts` and the package publishes only
`.`, so the new re-export does not reach the published entry — measured as zero
occurrences of `standaloneActionOwnerKey`, `standaloneActionObjectName` and
`GLOBAL_ACTION_OBJECT_KEY` in the built `packages/runtime/dist/index.d.ts`,
against a positive control of 32 for `HttpDispatcher`.

The docblocks that promised lockstep are replaced by welds that enforce it —
`action-owner-key-single-source.test.ts` in each package — because a docblock
is not a check. Each is scoped to its own package's source, so neither becomes
a cross-package test input.
