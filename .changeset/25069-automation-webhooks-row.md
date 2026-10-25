---
'@objectstack/skills': patch
---

docs(skills): the objectstack-automation capability table says a declared webhook or auto-launched flow is refused without its `requires` pair, not silently undelivered

Clause-②: no
Metadata-protocol: none

The 〈Prerequisite — declare the capabilities your nodes need〉 table in `objectstack-automation/SKILL.md` said that without `webhooks` in `requires` "nothing [is] delivered outbound", and that without `triggers` "flows register, never fire". Neither is what `defineStack` does: a declared webhook while `requires` omits `webhooks`, `realtime` or both is refused with `STACK_WEBHOOK_CAPABILITY_REQUIRED` (422), and an auto-launched flow while `requires` omits `triggers`, `automation` or both is refused with `STACK_TRIGGER_CAPABILITY_REQUIRED` (422) — at `os validate`, `os build`, `os dev` and `os serve` alike. The two rows now name the pair each surface owes and the refusal code; the lead-in says the refusal is at load time and that neither token implies the other. The `requires: [...]` example block under the table is folded into the lead-in to keep the skill within its token ceiling.
