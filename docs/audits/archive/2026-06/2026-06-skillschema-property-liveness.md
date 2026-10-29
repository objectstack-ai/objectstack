# Audit: SkillSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ai/skill.zod.ts`. **Consumers**: framework `service-ai` (`skill-registry`, `agent-runtime`); objectui `SkillPreview`, `default-schemas`.

## LIVE & necessary
`name`, `label`, `description`, `instructions` (all injected into the agent system prompt — `skill-registry.ts:247-249`), `tools[]` (the real tool-contribution path incl. `action_*` wildcard expand — `:206-227`, merged at `agent-runtime.ts:287`), `active` (inactive dropped — `:93`), and **`triggerConditions[]`** — the **sole** activation gate (AND of `{field,operator,value}`, operators eq/neq/in/not_in/contains — `:153-189`).

## 🔴 `triggerPhrases` is display-only
Despite the schema/doc framing it as "phrases that activate this skill," **nothing matches user text against them** — no intent/phrase matcher exists. They only populate the slash-command palette summary (`toSummary`). Intent routing is unimplemented.

## 🔴 `permissions` is dead at runtime + naming drift
No code restricts a skill (or its tools/prompt) by `skill.permissions`. The spec field is `permissions`, but docs/preview call it **`requiredPermissions`** and label it "required perm" (`SkillPreview.tsx:80`) — a field that exists by a different name and is enforced nowhere.

## 🟠 Studio preview & form out of sync (operators get a misleading view)
- `SkillPreview.tsx:151` renders `cond.type`/`cond.expression` (CEL shape) but the spec is `{field,operator,value}` → real conditions show raw/blank.
- `SkillPreview` reads a non-existent `model` field (`:50`) — never renders for valid skills.
- The schema-driven create/edit form (`default-schemas.ts:176-185`) exposes only name/label/description/instructions/tools — **`triggerConditions` (the one activation-critical field), `triggerPhrases`, `permissions`, `active` are not editable**. Correct skill gating is code-only (`defineSkill`/raw JSON).

## Recommendation
Implement phrase/intent matching for `triggerPhrases` or remove it. Enforce `permissions` (and fix the `requiredPermissions` naming) or drop it. Add a `triggerConditions` editor to the skill designer; fix the preview's condition shape + phantom `model`.
