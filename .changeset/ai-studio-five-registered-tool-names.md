---
"@objectstack/spec": minor
---

`PLATFORM_TOOLS_BY_PACKAGE['service-ai-studio']` lists the five tools the cloud AI runtime registers that it had been omitting: `get_authoring_rules`, `load_tools`, `open_record`, `test_flow` and `toggle_flow`. Added in the list's existing alphabetical order; nothing else in the registry moves.

The omission was not cosmetic. `PLATFORM_PROVIDED_TOOL_NAMES` is the load-bearing half of `skill.tools[]` reference integrity under ADR-0109 — the default third-party authoring path declares no tool records at all, so a `skill.tools[]` entry resolves against this registry or against the materialised `action_<name>` family and against nothing else. While these five were absent, a skill naming any of them was reported by `validate` / `lint` as a **fictional** tool reference (`ai-skill-tool-unresolved`), which is precisely the failure the registry was created to end. Five previously-refused references are now accepted; a name registered by nobody is still refused.

The module's own maintenance contract already said why an omission is worse than no registry at all — "an out-of-date registry is worse than no registry, because consumers now trust it" — and a second consumer had already paid for it: `@objectstack/mcp` gives a listed name `openWorldHint: false`, and the Studio's tool-step labels read the same set.

This is the data half only. Making the owning package's conformance test **derive** the union from what `plugin.ts` actually registers, instead of restating it, is tracked separately in the cloud repository; re-copying the list correctly resets the clock rather than stopping it.
