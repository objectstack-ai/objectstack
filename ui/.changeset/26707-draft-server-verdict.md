---
'@object-ui/app-shell': patch
---

fix(app-shell): the edit page shows a pending draft's own server verdict (objectstack#26707)

The edit page read `_diagnostics` from the layered read alone, which judges the published body, so a pending draft the publish refuses reached the canvas Problems panel and the diagnostics banner as valid. The draft read's `_diagnostics` now carries the publish's verdict on the draft, and the page takes it whenever it holds a draft: on load, after each autosave, after publish and after discard. Where a live client parse exists, the server errors the client parse does not raise are shown beside it, each once.

Clause-②: no
Metadata-protocol: none
