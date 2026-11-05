---
'@objectstack/objectql': patch
---

refactor(objectql): the private docblocks of 36 hand-series stubs in `engine.ts` move into their hand modules, onto the functions that hold their bodies; no behaviour or public declaration changes

Clause-②: no
Metadata-protocol: none

- A new third pass of the `engine.ts` codemod, `--hand-docs`, moves a private hand-series stub's docblock onto the function its stub calls, as the first two passes already do for the bodies they move. A public or protected method keeps its docblock on the class.
- This is the first of two slices: 8 hand modules here, the other 9 next. `engine.ts` goes from 13,544 to 12,615 lines.
- Nothing to do on upgrade: the exported names, the public `.d.ts` surface and what every method does are the same.
