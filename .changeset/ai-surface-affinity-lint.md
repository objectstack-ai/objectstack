---
"@objectstack/lint": minor
"@objectstack/spec": patch
---

feat(lint): `validate-ai-surface-affinity` — skill ↔ agent surface affinity is now linted (#3820)

An agent binds a product surface (`'ask'` | `'build'`, ADR-0063 §1) and a skill
declares which surface it belongs to (`'ask'` | `'build'` | `'both'`, §3). The
runtime refuses an incompatible binding with a **load error at chat time** —
after parse, validate, and deploy all passed cleanly. The new rule reports that
contradiction statically, and joins `REFERENCE_INTEGRITY_RULES`, so
`objectstack validate`, `lint`, and `compile` all pick it up with no CLI
changes.

Scope is deliberately narrow (zero false positives by construction): only
bindings where **both** the agent and the skill are declared in the same stack
are checked. `agent.skills[]` names that don't resolve in-stack (kernel skills
are runtime-registered and statically invisible) are skipped — resolving those
namespaces is #3820 D0/D2, decided by ADR-0109 (Proposed).

The spec side is doc-truth only, no schema shape changes:

- `stack.agents` is documented as **platform-internal** (ADR-0063 §2 — the
  kernel ships exactly two agents; third parties extend via skills), replacing
  prose that still described the withdrawn ADR-0040 per-app-copilot model.
- `stack.tools` is documented as declaration-only pending the ADR-0109 tool
  authoring model.
- `app.defaultAgent` is re-documented as a surface-binding knob (`'ask'`
  implicit / `'build'` for authoring surfaces), not a custom-agent slot.
- `SkillSchema` now states that a per-skill `permissions` field deliberately
  does not exist (ADR-0049) — authoring one is silently stripped; access is
  gated by `agent.access` / `agent.permissions` and per-tool authz.
