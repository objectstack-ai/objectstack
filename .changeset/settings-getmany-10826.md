---
'@objectstack/service-settings': patch
---

`SettingsService.getMany(namespace, keys, ctx)` resolves several same-namespace keys with at most two row loads instead of one per key (#10826) — env-overridden keys still answer without touching the store, and every key's value/source/lock/cascade deep-equals the per-key `get()` answer by construction (the cascade is extracted, not copied). `getNamespace` resolves through the same grouped path.
