---
'@objectstack/core': patch
---

`resolveLocalizationContext` prefers `settings.getMany` — one grouped namespace read instead of three per-key `get()`s (#10826); older services without `getMany` keep the three parallel gets, and a thrown `getMany` lands in the same direct `$in` fallback a thrown `get` did.
