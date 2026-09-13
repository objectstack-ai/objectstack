---
'@objectstack/spec': patch
---

Correct `aliases`' documented contract: it is not "only for what edit distance cannot reach".

`strictObject`'s `aliases` option was documented as a universal in the three places an adopter reads — the module docblock in `shared/strict-object.ts`, the `StrictObjectOptions.aliases` JSDoc an editor shows on hover, and the same JSDoc on the published `strictUnknownKeyError`'s `StrictUnknownKeyErrorOptions.aliases` — all saying aliases are "semantic near-misses edit distance cannot reach". The word *cannot* denies the option's second job.

The lookup is `aliases[aliasProbe(key)] ?? findClosestMatches(key, knownKeys, maxDistance, 1)[0]`: an alias is consulted **before** the distance fallback and wins outright. So an entry is equally right when distance *does* reach the key and answers with the wrong one — `hosts` is 2 edits from the declared `hooks` against a budget of `Math.max(2, Math.floor(5 / 3))` = 2, so on the plugin `permissions` block the entry is what keeps an author off lifecycle hooks.

Neither role is rare, and the correction carries its own count rather than the hedge it replaces. Measured over every surface the `strictObject` registry records, 2026-09-11: **1910** alias entries, **1658** unreachable by distance, **252** reachable — 211 where the fallback would have answered identically, and **41** where it answers a different key the entry overrules.

The failure mode the old sentence produced is precise and has a live carrier: an adopter with a reachable-but-wrong near-miss read "edit distance cannot reach", concluded `aliases` was not the tool for their case, and left the confident wrong suggestion in place.

Prose only. No alias is added or removed, no schema, key list, strictness or error message changes, and `visibleWhen → visible` (verified still unreachable) stays as the proving case for the gap half.
