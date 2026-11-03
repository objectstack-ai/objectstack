---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's cross-package metadata list (`/studio/~all/metadata/TYPE`) opens and stays open

Clause-②: no
Metadata-protocol: none

The metadata list repaired `?package=` whenever Studio's "All metadata" area named no package. On the cross-package leg that wrote the first project package into the URL, and the area then moved the page onto that package's leg, so the list of a type across packages could not be opened, with or without `?package=all`. Every package-less Setup metadata URL and the retired Packaged automation bookmark land there.

On the cross-package leg (outside the environment scope) the list now keeps no package and never repairs one. It lists every row the read returns, each row opening its owning package. Only Create picks a package, the same one Setup's list would pick, and opens that package's create. A package's area and Setup's list are unchanged.
