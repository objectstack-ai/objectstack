---
'@objectstack/core': patch
---

fix(core): a release artifact entry wrapped correctly whose content is refused ends its refusal on that content refusal, not on advice about the wrapper or about glob patterns

Clause-②: no
Metadata-protocol: none

`resolveArtifactPackageEntries` (ADR-0130 D4) refuses a `packages[]` entry as `INVALID_ARTIFACT_PACKAGE_ENTRY` / `422` and quotes the entry's parse issues. It used to append the same two pieces of advice to every such refusal: wrap an inlined body as `{ manifest: { … } }`, and the body holds definitions, not the authoring manifest's glob patterns. So an entry wrapped correctly whose record page places no component, whose `manifest.id` is invalid or whose body carries an undeclared key pointed its author at the wrapper and at globs, away from the one thing to fix.

The advice now follows the issue it answers. The wrapper advice is given when the entry itself is not an object or carries keys beside `manifest` / `source` (an inlined body), or when its `manifest` is missing or not an object. The assembled-body advice is given when `manifest.objects` or `manifest.datasources` (or an element of either) holds a string. Any other refusal ends on the quoted issues and, when issues are withheld, their count. A quoted issue that already ends on a period is no longer followed by a second one. The error code, the status, the leading sentence and the quoted issues are unchanged, and so is what is refused.
