---
'@object-ui/console': patch
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-list': patch
---

feat(ui): the console's pages set text in two sizes, 14 and 12, and two weights, 400 and 500

Clause-②: no
Metadata-protocol: none

- **Two sizes.** Body text, list cells, field values, inputs, menu items, toolbar controls and buttons are 14px (`text-sm`); field labels, column headers, counts, timestamps, hints and chip text are 12px (`text-xs`). The hard-coded 13px is gone from the console's runtime pages, and the 10px, 11px and other odd sizes there are 12px. The in-cell editor is 14px, like the cell it edits.
- **Two weights.** Record names, tabs, buttons, section titles and column headers are 500 (`font-medium`); body text is 400. Weight 600 and 700 stay only on page and dialog titles 18px and larger. `DropdownMenuLabel` is weight 500 through a declared local patch on the Shadcn primitive (`dropdown-menu-label-medium-weight` in `ui/scripts/shadcn-local-patches.mjs`), so it survives a registry sync.
- **Not changed:** Studio and metadata administration internals, the settings pages, developer tools, phone-only layouts, avatar initials, authored markdown and SDUI heading typography, the docs reader's prose size, and the shape of coloured option badges (still pills).
- A list column with no declared width measures its content, so it grows with the 14px text; a column whose width a view or a user set keeps that width and shows about 8% fewer characters before it truncates.
