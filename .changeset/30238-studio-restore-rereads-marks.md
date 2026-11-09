---
'@object-ui/app-shell': patch
---

fix(studio): after Restore package original, the rail's customized mark and the "only customizations" count read the restored item without a reload (#30238)

Clause-②: no
Metadata-protocol: none

- **Before.** On an installed (read-only) app, restoring a customized dashboard, report, view or page in Studio brought the shipped item back, but the Interfaces rail kept marking it customized and "only customizations" kept counting it until the page was reloaded. The surface read the base's customizations (`GET /api/v1/packages/:id/customizations`) again only after a publish, and a restore deletes the pair's row without publishing.
- **Now.** The surface reads them again on every metadata-refresh pulse, which a restore already sends (as do a publish and a copilot publish), so every pillar rail's marks and "only customizations" count follow the restore. A publish still reads once. The All metadata area's pages make their own read each time one opens, so they already showed the restored state.
