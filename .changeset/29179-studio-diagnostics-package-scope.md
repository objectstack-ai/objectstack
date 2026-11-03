---
'@object-ui/app-shell': patch
---

fix(app-shell): inside a package's Studio "All metadata" area, the Diagnostics page sweeps only that package, as the directory beside it does

Clause-②: no
Metadata-protocol: none

The Diagnostics page (`<root>/_diagnostics`) asked the server for the environment-wide sweep even inside one package's area, while the directory beside it asked for that package's. So a package whose directory read clean, with no "View all issues" link, listed another package's invalid item on its Diagnostics page, and that row's link, built relative to the open package's area, opened an unrelated page instead of the item. The page now reads the area's package and sends it with the sweep (`GET /api/v1/meta/diagnostics?package=…`), so its count matches the directory's and every row is an item of the open package, linked to it there. The cross-package leg (`/studio/~all/metadata/_diagnostics`) and Setup's Diagnostics page keep the environment-wide sweep.
