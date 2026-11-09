---
'@objectstack/skills': patch
---

docs(skills): more of objectstack-formula's self-contained examples are type-checked by `check:skill-examples`

Clause-②: no
Metadata-protocol: none

Five more fenced TypeScript blocks in `skills/objectstack-formula/SKILL.md` carry the opt-in check marker, so 6 of its 9 are now compiled against the spec: the coalesced text formula and the guarded divisor gain `import { F }`, the dynamic seed values gain `import { cel }` and a `const`, and both `previous`-transition predicates gain `import { P }`, all from `@objectstack/spec`. No example was wrong. The three ❌ blocks stay unmarked on purpose, and the file now says so once. The marks are paid inside the file by removing restatements: the intro's "canonical reference" sentence (the frontmatter description says it), the ISCHANGED sentence (the translation table's `ISCHANGED(x)` row says it), and the list of field rule keys before `conditionalRequired` (the Surfaces table's `Field` row lists them). No rule's teaching changes.
