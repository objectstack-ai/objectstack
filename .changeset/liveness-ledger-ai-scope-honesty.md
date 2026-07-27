---
---

docs(liveness): correct three ledger entries that counted an authoring/preview renderer as a runtime consumer (#1878 §3 recheck)

`skill.permissions` and `agent.knowledge` were marked `live` citing only a
metadata-admin PREVIEW panel — which echoes what the author typed and proves
nothing about enforcement. Both are corrected to `dead` + `authorWarn` with an
actionable hint. `action.disabled`'s evidence is corrected to the six real
rendering surfaces (its verdict was right for the wrong reason and hid a
five-surface silent no-op, since fixed in objectui#2863). Ledger-only; releases
nothing.
