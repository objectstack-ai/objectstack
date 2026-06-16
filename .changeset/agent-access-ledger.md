---
---

chore(spec): correct the agent liveness ledger — `access`/`permissions` are LIVE (enforced by `evaluateAgentAccess` at the chat route, #1884, which landed after the 2026-06 audit that still listed them dead); `visibility` is `experimental` (intentionally not enforced). Repo-internal tooling; no package version impact.
