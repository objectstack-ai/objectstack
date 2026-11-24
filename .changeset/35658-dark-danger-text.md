---
'@object-ui/components': patch
'@object-ui/console': patch
'@object-ui/cli': patch
'@object-ui/plugin-gantt': patch
---

fix(ui): danger text is readable in dark theme

Clause-②: no
Metadata-protocol: none

In dark theme, `text-destructive` (a menu's Delete, error messages, danger links) used the deep red that is the fill of red buttons, about 1.6:1 on a dark menu. Text utilities now read their own token: each shipped `@theme` maps `--text-color-destructive` to `--destructive-text`, which only `.dark` defines (a brighter red that clears 4.5:1 on every dark surface). Light theme leaves it unset and falls back to `--destructive`, so it is unchanged; `bg-`, `border-` and `ring-destructive` and red buttons keep `--destructive`. New apps from `objectui init` carry the same split, and the Gantt resource view's over-capacity label reads the text token. A host that overrides `--destructive` for its own dark theme can set `--destructive-text` beside it.
