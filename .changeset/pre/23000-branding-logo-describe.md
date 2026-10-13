---
'@objectstack/spec': patch
---

The description of `branding.logo` on an app now states the shape of the one asset it takes: a 1:1 square app icon, SVG preferred, at least 64 px, which each surface scales to the size it needs, with no second size and no wordmark slot. Text only; no schema changes: the key stays an optional string, the accept set is byte-identical, and a non-square value is not refused because a URL string does not carry its ratio.
