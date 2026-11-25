---
'@object-ui/app-shell': patch
---

chore(studio): one table holds the order and the 常用 / 高级 tier of every type Studio's left menu lists

Clause-②: no
Metadata-protocol: none

`studioMenuPlacement.ts` adds `STUDIO_MENU_PLACEMENT`, one ordered list of `{ type, tier }` rows. The common rows are object, app, page, dashboard, report, flow, permission, agent, tool and skill, in that order; every other type the directory lists is advanced, picklist and email template included. The table holds order and tier only: a type's group stays its served registry `domain`. A test holds the list against `DEFAULT_METADATA_TYPE_REGISTRY`, so a newly registered type fails until it has a row. Nothing reads the table yet, and the menu draws exactly what it drew before.
