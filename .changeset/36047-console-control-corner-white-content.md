---
'@object-ui/console': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
---

feat(ui): one 8px corner for every control, a white content area beside a light grey sidebar, and badges at weight 500

Clause-②: no
Metadata-protocol: none

- **Controls share one corner, 8px.** Buttons, inputs, selects, toolbar controls, menus and tab lists are `rounded-md`, which the console theme now sets to 8px (it was 12px, derived from the 14px card corner). What sits inside one of them, a tab trigger in its list or a menu row, is `rounded-sm`, 6px. Cards keep their 14px corner, and dialogs, popovers and drawers keep theirs.
- **Chips follow.** A lookup chip in a list cell (it was 4px), a person or record chip in a form's lookup field and its selection tray, and the list's Sort, Filter and condition chips (they were pills) take the same 8px corner. Coloured option badges stay pills.
- **The content area is white.** The console's `--background` is white instead of the grouped grey, so a list, a record page, a kanban board and the top bar sit on white. The sidebar is the one light grey surface beside it, with its hairline border; in the dark theme the content area is the darkest step and the sidebar one step lighter.
- **Badges are weight 500.** `Badge` was `font-semibold` (600), outside the console's two text weights; it is `font-medium` (500). This is a declared local patch on the Shadcn primitive (`badge-medium-weight` in `ui/scripts/shadcn-local-patches.mjs`), so it survives a registry sync.
