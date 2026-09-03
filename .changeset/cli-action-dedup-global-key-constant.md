---
"@objectstack/cli": patch
---

refactor(cli): spell the action-dedup object-less key as `GLOBAL_ACTION_OBJECT_KEY` (#14669)

`os lint` dedups action declarations on the engine's composite registration key
(`<objectName>:<name>`), and the object half of that key terminated on a bare
`'global'` string literal in `lintConfig`'s `PREFIXED_TYPES` table. The engine's
own writers stopped spelling the literal: PR #14667 converged
`ObjectQLPlugin.actionObjectKey` onto the shared `GLOBAL_ACTION_OBJECT_KEY`
constant for exactly this reason — a copy that agrees by value today is the one
that parts from the writer in silence the day the constant moves, with no test
in the repo able to see it. This reader now imports the constant from
`@objectstack/objectql`, which `@objectstack/cli` already depends on.

**No behaviour moves.** `GLOBAL_ACTION_OBJECT_KEY` is `'global'`, so every key
this table builds is byte-identical to the one it built before; the #5510 dedup
suite (`lint-namespace-prefix.test.ts`, 15 declarations over 5 objects) passes
unchanged. Only `objectName` is read, exactly as before — the `object`/`entity`
aliases are still rejected upstream by `ActionSchema`'s strict shape and are
deliberately not admitted here.
