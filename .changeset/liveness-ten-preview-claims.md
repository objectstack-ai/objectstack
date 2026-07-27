---
---

docs(liveness): re-verify the last ten preview-only `live` claims — eight were wrong (#3686)

Closes the preview-claim sweep. Of the 13 properties a 2026-06 pass marked
`live` citing only a metadata-admin preview panel, **10 were wrong** (77%).
Corrected: `action.shortcut`, `action.bulkEnabled`, `flow.active`,
`skill.triggerPhrases`, `tool.category`, `tool.requiresConfirmation`,
`tool.active`, `tool.builtIn` → `dead` + `authorWarn`; `action.execute` and
`flow.status` keep `live` with their real runtime readers cited. Also fixes
`flow.json`'s file-level note, which claimed "status/active gate nothing" —
true when written, falsified a month later by `497bda853`. Ledger-only;
releases nothing.
