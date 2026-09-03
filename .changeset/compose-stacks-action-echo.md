---
"@objectstack/spec": patch
---

fix(spec): `composeStacks` carries each bound standalone action once in the composed object — the second merge no longer re-appends the copy each input's build already made (#14847)

`defineStack` ends with `mergeActionsIntoObjects`: every standalone action
carrying `objectName` is copied into that object's `actions` on the way out,
and the standalone stays in `stack.actions`. `composeStacks` concatenates its
inputs' `actions` and ended with the same merge — so each bound action was
appended to its object a SECOND time, beside the copy the input's own build had
put there: two copies for one declaration, three with three stacks under
`objectConflict: 'override'` / `'merge'`, `manifest: 'preserve'` inheriting it.
Downstream (the runtime note recorded on #14686): `collectActionDeclarations`
pushes every embedded entry, so MCP `listActions` listed a composed app's bound
actions twice and bare-name `resolveActionByName` refused the ambiguity; `os
build` shipped the doubled entries to `dist/objectstack.json` unremarked,
because `compile.ts` validates the lowered stack with `safeParse`, not
`defineStack`.

`mergeActionsIntoObjects` is now idempotent over its own output: a bound action
the object already carries BY IDENTITY is not appended again. Identity against
the standalone list, deliberately not equality — the only way an entry of
`stack.actions` is the very same object as an entry of `object.actions` is that
a previous merge put it there. A hand-written twin (one action authored in both
positions) is two objects after the strict parse and is still refused by
#14686's same-key rule, which runs before the merge and is untouched; a marker
cannot do this job (`ActionSchema` is strict — an unknown key is refused).
`collectComposedActionKeyCollisions` (#14854) is untouched too: it runs before
the merge and counts distinct stacks per key, so its refusals and their wording
do not move.

Shape change, and only this: a composed object's `actions` is the previous
output minus the duplicate entries — nothing is reordered, and `order` sorts the
once-merged set as before. The accept set does not move: nothing that composed
before is refused now, and nothing refused is accepted. Round trip: a composed
artifact is still refused by `defineStack` when an input binds an action — a
built artifact carries each bound action in both positions by #14686's landed
design (author the source shape, not the artifact) — but with the same
"declared twice" line a single built input gets, no longer "3 times"; with no
bound action it parses cleanly, as before. One measured consequence outside
composition: under `strict: false`, ONE action object placed in both positions
is now carried once (before: twice) — a single declaration, in the mode that
opts out of #14686's walk by choice.
