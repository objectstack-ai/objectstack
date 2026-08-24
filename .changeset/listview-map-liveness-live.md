---
"@objectstack/spec": patch
---

**Liveness-ledger verdict:** `view.list.map` (`ListViewSchema`'s view-level `map` block) moves `planned` → `live` (#11442).

objectui#5908 landed the missing half of the forward: `packages/plugin-list/src/ListView.tsx`'s `resolveListMapConfig` now merges the view-level `map` block over the legacy `options.map` bag before `case 'map'` builds the `object-map` schema, and the same merged config also feeds the visualization-switcher's capability gate — so a view that binds its coordinates only in the spec's `map` block both renders on the map surface and is no longer filtered out of `allowedVisualizations`. Nothing about the schema shape or the authoring-time validation changed; only the runtime consequence of authoring the key does.

Pinned by objectui `packages/plugin-list/src/__tests__/ListView.mapViewLevelConfig.test.tsx` (the forward, against a spy) and `packages/plugin-map/src/ObjectMap.listViewMapConfigReach.test.tsx` (the end-to-end read through a real `ObjectMap` — markers, titles, camera). Re-measured against objectui `origin/main@08ca73f8` (squash commit `e2e8e68` for #5908 confirmed an ancestor).
