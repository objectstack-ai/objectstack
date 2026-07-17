---
"@objectstack/spec": patch
"@objectstack/lint": patch
"@objectstack/cli": patch
---

Reject view containers that define no views. A flat list-view object (`{ name, label, type, columns, ... }`) parses to an empty `ViewSchema` container because Zod strips unknown keys — zero views register and the Console silently renders nothing. `defineView()` now throws on a zero-view container, and `os validate` gains a `view-container-shape` check (`validateViewContainers` in `@objectstack/lint`) that reports flat or empty `views: []` entries pre-parse with a wrap-it fix hint.
