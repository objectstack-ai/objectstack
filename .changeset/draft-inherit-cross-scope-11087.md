---
'@objectstack/metadata-protocol': patch
---

Draft package inheritance (#11087) resolves the overlaid active row with the same two-scope reach as `listDrafts` (caller org + env-wide) — an org-scoped console save now inherits from the env-wide active base instead of finding nothing in its own scope.
