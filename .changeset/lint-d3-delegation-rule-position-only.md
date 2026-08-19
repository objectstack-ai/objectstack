---
"@objectstack/lint": minor
---

fix(lint): the ADR-0091 D3 "delegation row needs a reason" rule is scoped to `sys_user_position` (#9730)

`delegated_from` was retired from `sys_user_permission_set` (ADR-0049
enforce-or-remove, maintainer ruling 2026-08-18), so the security-posture
lint's D3 dual-audit rule no longer reads the key on that table — linting a
retired column would imply it still exists, and on that table this rule was
the column's *only* enforcement, which is exactly the advisory-security shape
the ruling removed. A seed row that still carries the key is refused loudly
downstream by the engine's schema preflight (`400 INVALID_FIELD`).

The D2 rule (a seed grant whose `valid_until` is already past or unparseable
is dead on arrival) still covers **both** grant tables — `valid_until` remains
declared and resolution-enforced on both. Only the two rules' object scopes
diverge; no rule id, severity or message changed.
