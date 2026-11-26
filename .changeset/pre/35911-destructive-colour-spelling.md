---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-markdown': patch
'@object-ui/components': patch
'@object-ui/core': patch
'@object-ui/cli': patch
'@object-ui/console': patch
---

fix(ui): danger colours render red in both themes, and light danger text clears 4.5:1

Clause-②: no
Metadata-protocol: none

- The grid and list views' export-error line, and the Markdown caution alert's border and title, set their colour to a bare `var(--destructive)`. That variable holds an HSL triplet, not a colour, so the browser dropped the declaration and the text rendered in the inherited colour. The export-error line now uses the `text-destructive` utility and the caution alert reads `hsl(var(--destructive-text, var(--destructive)))`. The Markdown theme's heading anchors, quote and meta tokens and blockquote border and background had the same defect with other theme variables and now wrap them in `hsl()` too.
- The flow preview's invalid-edge stroke and arrowhead paint with the danger text colour, so they stay readable on the dark theme.
- The light theme now sets its own `--destructive-text`, red-700 (`#b91c1c`, `0 73.7% 41.8%`), so `text-destructive` reads at 6.47:1 on white instead of 3.76:1. `--destructive`, the brand red used for button and badge fills, is unchanged. The same value is in the stylesheet that `objectui init` generates.
- A theme's `error` colour applied through the theme engine still sets `--destructive`, and now also derives a danger text colour for each mode from it (same hue, lightness moved until it reads at 4.5:1 on that mode's surfaces), written as `--destructive-text-light` and `--destructive-text-dark`. The shipped stylesheets read those into `--destructive-text` in their light and dark blocks, so a custom red drives danger text and stays readable in both modes. A host stylesheet that overrides `--destructive` by hand should set `--destructive-text` beside it in each mode.
