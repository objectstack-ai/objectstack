---
"@objectstack/spec": minor
---

ADR-0040: unify the platform assistant. The default `data_chat` agent becomes the single platform assistant carrying both the data and authoring registers — the end user never picks an agent. It gains the `metadata_authoring` and `solution_design` skills (registered by the cloud AI Studio plugin; data-only deployments degrade gracefully as the skill registry ignores unresolved names), an intent preamble that classifies build/change vs data intent first and applies that register's discipline without mixing registers or narrating failures, an 'Assistant' persona, temperature 0.2, a guardrail blocklist union minus `alter_schema`/`drop_table` (the build register is draft-gated schema work per ADR-0033), a 60s execution budget, and react ×10 planning with replan.
