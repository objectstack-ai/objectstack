---
"@objectstack/objectql": patch
---

Fix metadata registry pollution: a packaged artifact's protection envelope (`_lock`/`_packageId`/`_provenance`) survives overlay hydration and reset (ADR-0010 §3.3). GET-list hydration used to register the sys_metadata overlay body under the registry's plain key, shadowing the artifact — a `_lock: full` app read back as unlocked after PUT+GET, and DELETE (reset) left the stale shadow in place until restart. Envelope readers now resolve through the shadow-immune `SchemaRegistry.getArtifactItem()`, hydration grafts the artifact envelope onto the overlay body (overlay content wins, artifact protection wins), and reset heals the registry via `removeRuntimeShadow()` — including self-healing on a no-op DELETE.
