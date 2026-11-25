---
'@object-ui/app-shell': patch
---

internal: move-only — Studio's Data, Automations and Access pillars move out of `StudioDesignSurface.tsx` into their own modules, taking it from 8,010 to 1,715 lines

Clause-②: no
Metadata-protocol: none

No behaviour change. Under `views/studio-design/`, `DataPillar.tsx` holds the Data pillar with its records-grid slot (`renderStudioGridList`) and its object draft-save shape. `AutomationsPillar.tsx` holds the Automations pillar and the published-flow-names read only it makes. `AccessPillar.tsx` holds the Access pillar with its "New similar" arrival reader and the list-row name label only it draws. The moved code is byte-identical apart from its imports. `StudioDesignSurface.tsx` imports the three pillars from there and re-exports them, with `renderStudioGridList`, so every import of them keeps working. The package's public exports are unchanged.
