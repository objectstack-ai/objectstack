---
'@objectstack/skills': patch
---

docs(skills): objectstack-platform names every cloud-only capability token

Clause-②: no
Metadata-protocol: none

- `skills/objectstack-platform/SKILL.md`, § `requires:`: the **Enterprise / cloud** bullet now names `audit-compliance` and `access-policy-console` beside `ai-seat` and `governance` as the tokens resolved only by cloud's objectos-runtime, matching `PLATFORM_CAPABILITY_TOKENS` and `PLATFORM_CAPABILITY_PROVIDERS` (`package: null`, `edition: 'cloud'`).
- Two clauses that restated the section's lead-in ("not in that map") are cut: "have no provider entry" on the tier-gated bullet and "has no open-edition provider" on the enterprise bullet.
- Nothing to do on upgrade: both tokens are already accepted by `defineStack`; this only teaches them.
