---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(spec,lint): ADR-0109 Phase 1 — platform tool-name registry + advisory `skill.tools[]` reference lint (#3820 R7)

ADR-0109 (revised) settles the AI tool authoring model: **the default
third-party path needs no tool records at all.** A skill's `tools[]` names
either a platform-registered tool or a tool the runtime materialises from the
app's own declarative actions (`action_<name>`) — the executable, its authz,
and its audit trail stay on the action/flow the app already ships. Tool
records are demoted to an optional AI-presentation refinement layer (Phase 2,
gated on acceptance).

Phase 1, shipped here:

- **`PLATFORM_PROVIDED_TOOL_NAMES`** (`@objectstack/spec/system`) — curated
  registry of every statically-named tool the cloud AI runtime registers,
  grouped by owning package, plus `PLATFORM_TOOL_FAMILY_PREFIXES` for the
  materialised `action_` family and `isPlatformProvidedToolName()`. The
  `PLATFORM_PROVIDED_OBJECT_NAMES` precedent, applied to tools; conformance
  tests live in the owning cloud packages.
- **`validate-ai-tool-references`** (`@objectstack/lint`) — the #3820 R7
  `skill.tools` branch, wildcard-aware, resolving against declared
  `stack.tools` ∪ the registry ∪ the materialised action family. Severity
  **warning** (ADR-0078 advisory-first ratchet): the registry cannot see
  third-party runtime plugins. Joins `REFERENCE_INTEGRITY_RULES`, so
  `validate`, `lint`, and `compile` all pick it up. On the HotCRM corpus it
  reports exactly the 10 fictional tool references (0 false positives on the
  6 that resolve).
- **`composeStacks` no longer drops `tools`** — the slot joins the
  concatenated array fields, so a declared record survives composition.
- `stack.tools` / AI-slot docs updated to the ADR-0109 model.
