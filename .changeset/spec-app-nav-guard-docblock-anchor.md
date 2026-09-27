---
'@objectstack/spec': patch
---

`app.zod.ts` docblocks: the navigation target-exclusivity guard now cites the commit that decided it, and says what that commit decided

Two docblock sentences in `src/ui/app.zod.ts` (which ships as source through the
package's `src/**/*.zod.ts` entry) cited a tracker number that no longer resolves
on GitHub. They now carry the lesson in words and anchor to commit `4cfc93b802`
in this repository's history: the `filters` docblock deliberately states no
precedence order, because objectui's hand-written mirror copied one from this
docblock and ended up accepting a combination the schema refuses; and
`objectNavTargetExclusivity` is exported so a mirror chains the schema's own rule.

Docblock text only. No schema, guard, accept set, export or `.describe()` string
changes.
