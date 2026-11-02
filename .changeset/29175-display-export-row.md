---
'@object-ui/plugin-list': patch
---

fix(plugin-list): every export entry in the list's Display popover stays inside the panel

Clause-②: no
Metadata-protocol: none

A list view that offers several export formats (for example CSV, XLSX and JSON) drew Refresh and one "Export as …" entry per format in a single footer group that could not wrap. At the popover's fixed width that group was wider than the panel, so the last entry ("Export as JSON") was clipped past its edge and, on a narrower window, off screen. The export entries now take a row of their own at the bottom of the footer, and that row wraps, so every format offered is visible and clickable; Reset and Refresh stay on the row above. Labels, export behaviour and the export permission gating are unchanged, and the popover keeps its width.
