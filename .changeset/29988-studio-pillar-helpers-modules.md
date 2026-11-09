---
'@object-ui/app-shell': patch
---

internal: move-only — Studio's flow rail helpers, pillar kit and Data pillar helpers move out of `StudioDesignSurface.tsx` into three modules, taking it under 10,000 lines (#29988, slice 4)

Clause-②: no
Metadata-protocol: none

No behaviour change. Three groups of helpers now live in their own modules under `views/studio-design/`. `AutomationsFlowRail.tsx` holds the Automations rail's flow status dot, its glyph tables, the flow reads and the new-flow trigger helpers. `StudioPillarKit.tsx` holds what every pillar shares: the held-edit notice, the unsaved-work and taken-identifier checks, the "Show me" focus helpers, the draft-saved announcement and the read-only link. `DataPillarHelpers.tsx` holds the Data pillar's field-name, CEL-stamp and form-preview helpers. The moved code is byte-identical apart from its imports and `export`s. `StudioDesignSurface.tsx` imports it from there and re-exports the five names it exported before, so every import of them keeps working. The package's public exports are unchanged.
