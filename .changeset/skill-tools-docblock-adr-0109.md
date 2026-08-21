---
"@objectstack/spec": patch
---

**Docs:** the `skill.tools[]` docblock now states ADR-0109's authoring model instead of its rejected alternative (#10356).

`SkillSchema.tools`' docblock told authors that "Tools should also be registered as first-class metadata (type: 'tool') unless they are dynamically materialised at runtime" — the shape ADR-0109 explicitly **rejected** ("a required tool record per exposed action": a second authoring step, a second namespace to keep consistent, and a second surface for AI authors to hallucinate into, for zero added capability). It also inverted the exemption, treating the materialised path as the exception when ADR-0109 makes it — together with the platform registry — the rule. The sibling docblock over `stack.zod.ts`'s `tools` already said the opposite, so the package shipped two contradictory answers to the same question.

The text now mirrors the resolution universe `@objectstack/lint`'s `validate-ai-tool-references` actually implements: a `tool` record is never required and the default third-party path declares none; a `skill.tools[]` name resolves against the stack's own `stack.tools[]` names, `PLATFORM_PROVIDED_TOOL_NAMES`, and the `action_<name>` family the runtime materialises from AI-exposed declarative actions (`ai.exposed` + `ai.description` on a headless action type, per ADR-0011). It also records that `stack.tools` is the optional Phase-2 AI-presentation refinement layer with no runtime reader until that phase lands — so a record authored today is inert, which the old sentence recommended authoring without saying.

Prose only: no schema shape, no `.describe()` text, no runtime behaviour and no authorable surface changes. It reaches the published package through the generated `.d.ts`, which is why it is graded rather than skipped — this is the docblock an AI author reads while writing `skill.tools[]`, the exact surface ADR-0109 was written to keep clean.
