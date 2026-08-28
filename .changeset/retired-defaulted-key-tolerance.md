---
'@objectstack/spec': minor
---

Retired-defaulted-key tolerance (#12840, class rule): a RETIRED key that carried a schema default is now refused only when it carries a NON-default value. The retired default parses as inert residue and is STRIPPED — the normalized output does not carry the key, and a parse → serialize round-trip converges to the clean shape.

Founding case: `permissions[].objects.<object>.allowRestore` / `.allowPurge` (#12497). Every artifact built by the published `@objectstack/spec` 17.x has both keys materialized as `false` in every permission entry (the pre-retirement schemas emitted `z.boolean().default(false)`), so the #12497 refusal was sentencing every previously built artifact — marketplace packages, installed environments — to a boot failure on the next runtime upgrade. Those artifacts now parse; `allowRestore: true` / `allowPurge: true` keep the full #12497 refusal with the prescription byte-for-byte, and nothing is un-retired: the keys stay tsc-`never` tombstones on the authoring surface, and the authorable-surface/JSON-schema artifacts still publish the `[RETIRED]` rows.

Ships as a reusable helper — `acceptRetiredDefaultResidue(schema, residue)` in `packages/spec/src/shared/retired-key.ts` — where `residue` is the retired default captured as a literal at retirement time (never re-read from anywhere live). The next retirement of a defaulted key reuses the helper instead of re-inventing the judgement.
