---
'@objectstack/cli': minor
---

feat(cli)!: `os migrate plan` / `apply` refuse a config whose AI plugin only `os serve` would mount, reading serve's own AI auto-inject rule

Clause-②: no (narrowing)
Metadata-protocol: none

`os serve` auto-injects the AI service plugin (`@objectstack/service-ai`) when the stack's `requires` names `ai` or `ai-studio`, or the app's own `package.json` declares `@objectstack/service-ai` or `@objectstack/service-ai-studio`, unless the `ai` tier is off. That rule now lives in one exported predicate (`resolveAiServiceLoad`, with `mountsAiServicePlugin` for "the config already mounts it"). `serve` decides what it loads with it, unchanged for every input, and the composition the migrate commands share (`os migrate plan`, `os migrate apply`, the organization-ownership ceremony's `--apply`, and `os migrate unmapped-columns`) refuses with it.

**BREAKING** the migrate commands refuse a config they used to plan without the AI tables.

- **Why.** The migrate commands compose what `serve` composes so they plan the same tables, but they did not compose the AI plugin `serve` injects. A config with `requires: ['ai']` and no AI plugin got a plan with none of the `ai_*` tables `serve` declares, and `apply` applied it.
- **Before.** That config planned and applied with exit 0, and the AI tables were missing from the plan.
- **Now.** The run stops before planning with exit 1. The JSON `error` (and the ceremony's `boot-failed` detail) says that `os serve` auto-injects the AI plugin for this config, why (the `requires` token or the `package.json` dependency), and the remedy: mount the AI plugin explicitly in the config (`plugins: [new AIServicePlugin()]`, from `@objectstack/service-ai`), then re-run.
- **Who moves.** An app that relies on `serve`'s AI auto-inject and runs `os migrate`. Add the plugin to the config's `plugins`; `serve` then counts it as mounted and injects nothing, so it boots the same.
- **Unchanged.** A config that mounts the AI plugin plans as today. A config with the `ai` tier off (`tiers` without `ai`, or a preset without it) plans as today, as does a config that neither requires nor declares AI. `os serve` loads the same plugins for every config.

A composition that refuses (this one or any other) now hands stdout back before it throws, so the reservation the migrate boot takes for its JSON document no longer outlives the command.
