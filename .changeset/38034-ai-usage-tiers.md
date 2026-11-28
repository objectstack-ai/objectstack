---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the ChatDock AI usage ring shows a paid plan's personal allowance and team pool, and the notice once turns draw on the team pool

Clause-②: no
Metadata-protocol: none

`GET /api/v1/ai/usage` may now carry an optional `tiers` on a paid plan: the caller's personal share, the team pool it overflows into, whether turns draw on the pool, and a notice in four languages. The usage hook reads it in exactly that shape; a `tiers` of any other shape is dropped on its own and the `{ pool, breakdown }` reading stands, so the ring still renders. When `tiers` is present, the popover shows one row per tier (its status, its used share as a percentage, its reset) in place of the pool's single figure, and the notice in the console language (Chinese scripts read `zh`; `ja` and `es` read their own; every other language reads `en`). A caller with no personal share sees the team pool alone. The ring, the popover's status and reset line and the call to action keep reading `pool`. Without `tiers` (Free, self-hosted, an older backend) nothing changes. Two new console strings, `console.ai.usage.tierPersonal` and `console.ai.usage.tierTeamPool`, ship in every locale pack.
