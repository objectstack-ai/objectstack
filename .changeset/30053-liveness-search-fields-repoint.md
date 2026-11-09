---
'@objectstack/spec': patch
---

fix(spec): the liveness ledger's `query.searchFields` row cites `engine-find.ts#expandSearchOnAst`, where the hand-off lives, so `check:liveness` is green again

Clause-②: no
Metadata-protocol: none

- The row cited `engine.ts#expandSearchOnAst`. The body has lived in `engine-find.ts` since the `engine.ts` codemod split, and the last mention of `searchFields` in `engine.ts`, a private docblock, moved out with the first slice of the hand-series docblock move, so the check found no mention of the key in the cited file.
- Nothing to do on upgrade: only the shipped `liveness/query.json` evidence text changes.
