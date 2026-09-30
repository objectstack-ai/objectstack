---
'@objectstack/spec': patch
---

fix(spec): the `etl-pipeline-layer-retired` migration entry dates the `syncConfig.schedule` deletion to `@objectstack/spec` 17, not 18

Clause-②: no

The protocol-17 semantic entry `etl-pipeline-layer-retired` explains that connector-attached
`syncConfig` has no reader outside `packages/spec`, and cites the same measurement that removed
`syncConfig.schedule`. Its `replacement` text said that key was retired "in 18". It was deleted
in `@objectstack/spec` 17 under ADR-0049 (first released in 17.5.0), as the note at the deleted
position in `integration/connector.zod.ts` already says. The sentence now reads "the same measurement that deleted `syncConfig.schedule` in
@objectstack/spec 17 under ADR-0049".

Text only: no entry id, `surface`, conversion or matching logic changes, and `os migrate meta`
rewrites exactly what it rewrote before. The generated migration registry, `spec-changes.json`
and the protocol upgrade guide carry the corrected sentence.
