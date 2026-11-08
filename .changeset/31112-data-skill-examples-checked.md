---
'@objectstack/skills': patch
---

docs(skills): more of objectstack-data's self-contained examples are type-checked by `check:skill-examples`, and the `Field.*` factory example imports from the subpath that exports it

Clause-②: no
Metadata-protocol: none

Fourteen more fenced TypeScript blocks in `skills/objectstack-data` carry the opt-in check marker, so 25 of its 95 are now compiled against the spec: 8 of 10 in `rules/indexing.md` (index lists typed as `ObjectIndex[]` from `@objectstack/spec/data`), 4 more in `references/data-hooks.md` (the full `defineHook` definition and three pattern hooks, which gain their `defineHook` import), and one each in `rules/lifecycle.md` and `rules/field-types.md`. One example was wrong: `rules/field-types.md` imported `Field` from `@objectstack/spec`, which does not export it (the spec root has no namespace exports); it now imports from `@objectstack/spec/data`, and the prose no longer names the root. The ✅ script example in `rules/validation.md` gains the `name` every validation rule requires. The rest stay unmarked: fragments, shapes, ❌ examples, and the blocks whose file had no token headroom left to pay for a wrapper. No rule's teaching changes.
