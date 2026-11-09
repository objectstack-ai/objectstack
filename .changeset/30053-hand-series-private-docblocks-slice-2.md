---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

refactor(objectql): the private docblocks of the last 28 hand-series stubs in `engine.ts` move into their hand modules, onto the functions that hold their bodies; no behaviour or public declaration changes

Clause-②: no
Metadata-protocol: none

- The second and last slice of the `engine.ts` codemod's `--hand-docs` pass: 10 hand modules, 858 docblock lines. With the first slice, every private hand-series stub that had a docblock now keeps it beside its body; public and protected docblocks stay on the class. `engine.ts` goes from 12,618 to 11,752 lines.
- The liveness ledger's `query.groupBy` row now cites `engine-delete-and-aggregate.ts#aggregate`, where the body lives, because `engine.ts` no longer names the key.
- Nothing to do on upgrade: the exported names, the public `.d.ts` surface and what every method does are the same.
