---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-ai` skill names the `agent` type's environment-overlay switch by its protocol-18 spelling, `allowEnvironmentOverlay:false` (#22340 S3)

Clause-②: no

`skills/objectstack-ai/SKILL.md`'s "Platform agents — reference only" section said the `agent` type is closed with `allowOrgOverride:false`. That key was renamed to `allowEnvironmentOverlay` in protocol 18 (ADR-0131 D6 retired the per-organization overlay axis, so the key names the one scope it governs; the old key stays on the registry entry schema only as a tombstone that refuses at parse with the new name in its prescription), so the published line now reads `allowEnvironmentOverlay:false`. The value, the `allowRuntimeCreate:false` beside it and the ADR-0063 §2 citation are unchanged; nothing an author writes changes. The same rename is recorded in `AGENTS.md` rule 7 and as header amendment notes on ADR-0005 and ADR-0010, none of which publishes.
