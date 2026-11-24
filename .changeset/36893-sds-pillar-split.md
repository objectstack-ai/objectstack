---
'@object-ui/app-shell': patch
---

internal: move-only — Studio's Automations and Access pillars move out of `StudioDesignSurface.tsx` into their own modules, taking it from 7,948 to 4,732 lines

Clause-②: no
Metadata-protocol: none

No behaviour change. `AutomationsPillar.tsx` under `views/studio-design/` holds the Automations pillar and the published-flow-names read only it makes. `AccessPillar.tsx` holds the Access pillar with its "New similar" arrival reader and the list-row name label only it draws. The moved code is byte-identical apart from its imports. `StudioDesignSurface.tsx` imports both pillars from there and re-exports them, so every import of `AutomationsPillar` and `AccessPillar` keeps working. The package's public exports are unchanged.
