---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-markdown': patch
---

fix(ui): danger colours render red in both themes

Clause-②: no
Metadata-protocol: none

The grid and list views' export-error line, and the Markdown caution alert's border and title, set their colour to a bare `var(--destructive)`. That variable holds an HSL triplet, not a colour, so the browser dropped the declaration and the text rendered in the inherited colour. The export-error line now uses the `text-destructive` utility and the caution alert reads `hsl(var(--destructive-text, var(--destructive)))`, so both are red in light theme (unchanged red) and the readable danger red in dark theme. The Markdown theme's heading anchors, quote and meta tokens and blockquote border and background had the same defect with other theme variables and now wrap them in `hsl()` too. The flow preview's invalid-edge stroke and arrowhead follow the same dark-aware danger red.
