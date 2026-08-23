---
"@objectstack/spec": patch
---

**Docs:** `skill.zod.ts`'s two `@example` blocks stop handing the author a retired key that throws on parse (#11026).

Both TSDoc examples in `packages/spec/src/ai/skill.zod.ts` — the one over `SkillSchema` and the one over `defineSkill` — passed `triggerPhrases`, removed in `@objectstack/spec` 17.0.0 (#3896 audit close-out) and carried as a `retiredKey()` tombstone ~120 lines below the first of them. `defineSkill` calls `SkillSchema.parse()`, so both documented blocks **threw** when run: `invalid_type` at path `triggerPhrases`, expected `never`. A reader copying either block got a refusal on their first move.

The blocks now demonstrate the tombstone's own prescription instead of contradicting it. That prescription is a **split**, not a rename — routing intent belongs in `triggerConditions` (an AND of context field/operator/value), natural-language intent in `description` / `instructions`, the strings actually put in front of the model — and the `defineSkill` block shows both halves with each named. `tools` is required with no default, so both blocks carry it. Each block also opens with its own `import { defineSkill } from '@objectstack/spec';`, matching the convention the marked SDK examples in `packages/client-react/src` already use, so the block is self-contained as a consumer would resolve it.

The tombstone and every line of its guidance prose are **unchanged**, verbatim — they were always correct, and they are what the repaired examples now agree with.

Prose only: no schema shape, no `.describe()` text, no runtime behaviour, no authorable-surface movement, and `check:generated` moves nothing (the generated reference page `content/docs/references/ai/skill.mdx` renders the tombstoned row as `[REMOVED]` and carries neither example). It is graded rather than skipped because the text ships to consumers: the rewritten blocks are present in the built `dist/skill.zod-*.d.ts`, which is what an editor surfaces on hover, and `@objectstack/spec`'s `files` list publishes `src/**/*.zod.ts` so the docblock also travels in the npm tarball as source.
